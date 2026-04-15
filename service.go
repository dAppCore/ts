package ts

import (
	"context"
	"crypto/ed25519"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	core "dappco.re/go/core"
	io "dappco.re/go/core/io"
	"dappco.re/go/core/io/store"
	"dappco.re/go/core/scm/manifest"
	"dappco.re/go/core/scm/marketplace"
)

// Service wraps the CoreDeno sidecar as a framework service.
// Implements Startable and Stoppable for lifecycle management.
//
// Registration:
//
//	core.New()
type Service struct {
	*core.ServiceRuntime[Options]
	mu               sync.RWMutex
	sidecar          *Sidecar
	grpcServer       *Server
	store            *store.Store
	grpcCancel       context.CancelFunc
	grpcDone         chan error
	denoClient       *DenoClient
	installer        *marketplace.Installer
	supervisorCancel context.CancelFunc
	supervisorDone   chan struct{}
	desiredModules   map[string]moduleSpec
}

type moduleSpec struct {
	EntryPoint  string
	Permissions ModulePermissions
}

// NewServiceFactory returns a factory function for framework registration via WithService.
func NewServiceFactory(opts Options) func(*core.Core) (any, error) {
	return func(c *core.Core) (any, error) {
		return &Service{
			ServiceRuntime: core.NewServiceRuntime(c, opts),
			sidecar:        NewSidecar(opts),
			desiredModules: make(map[string]moduleSpec),
		}, nil
	}
}

// OnStartup boots the CoreDeno subsystem. Called by the framework on app startup.
//
// Sequence: medium → store → server → manifest → gRPC listener → sidecar.
func (s *Service) OnStartup(ctx context.Context) (err error) {
	defer func() {
		if err != nil {
			s.cleanupStartupState()
		}
	}()

	opts := s.effectiveOptions()

	// 1. Create sandboxed Medium (or mock if no AppRoot)
	var medium io.Medium
	if opts.AppRoot != "" {
		var mediumErr error
		medium, mediumErr = io.NewSandboxed(opts.AppRoot)
		if mediumErr != nil {
			err = fmt.Errorf("coredeno: medium: %w", mediumErr)
			return err
		}
	} else {
		medium = io.NewMockMedium()
	}

	// 2. Create Store
	dbPath := opts.StoreDBPath
	if dbPath == "" {
		dbPath = ":memory:"
	}
	s.store, err = store.New(dbPath)
	if err != nil {
		err = fmt.Errorf("coredeno: store: %w", err)
		return err
	}

	// 3. Create gRPC Server
	s.grpcServer = NewServer(medium, s.store)

	// 4. Load manifest if AppRoot set (non-fatal if missing)
	if opts.AppRoot != "" {
		m, loadErr := loadAppManifest(medium, opts.PublicKey)
		if loadErr != nil {
			err = fmt.Errorf("coredeno: manifest: %w", loadErr)
			return err
		}
		if m != nil {
			s.grpcServer.RegisterModule(m)
		}
	}

	// 5. Start gRPC listener in background
	grpcCtx, grpcCancel := context.WithCancel(ctx)
	s.grpcCancel = grpcCancel
	s.grpcDone = make(chan error, 1)
	go func() {
		s.grpcDone <- ListenGRPC(grpcCtx, opts.SocketPath, s.grpcServer)
	}()

	// 6. Start sidecar (if args provided)
	if len(opts.SidecarArgs) > 0 {
		supervisorCtx, supervisorCancel := context.WithCancel(ctx)
		s.supervisorCancel = supervisorCancel

		// Wait for core socket so sidecar can connect to our gRPC server.
		waitErr := waitForGRPCSocket(ctx, opts.SocketPath, 5*time.Second, s.grpcDone)
		if waitErr != nil {
			err = fmt.Errorf("coredeno: core socket: %w", waitErr)
			return err
		}

		if startErr := s.sidecar.Start(supervisorCtx, opts.SidecarArgs...); startErr != nil {
			err = fmt.Errorf("coredeno: sidecar: %w", startErr)
			return err
		}

		// 7. Wait for Deno's server and connect as client
		if s.shouldConnectDeno() {
			dc, dialErr := dialDenoReady(supervisorCtx, opts.DenoSocketPath, 10*time.Second)
			if dialErr != nil {
				err = fmt.Errorf("coredeno: deno client: %w", dialErr)
				return err
			}
			s.setDenoClient(dc)
		}

		s.supervisorDone = make(chan struct{})
		go s.superviseSidecar(supervisorCtx)
	}

	// 8. Create installer and auto-load installed modules
	if opts.AppRoot != "" {
		modulesDir := filepath.Join(opts.AppRoot, "modules")
		s.installer = marketplace.NewInstaller(medium, modulesDir, s.store)

		if s.denoClient != nil {
			installed, installedErr := s.installer.Installed()
			if installedErr != nil {
				err = fmt.Errorf("coredeno: installed modules: %w", installedErr)
				return err
			}
			for _, mod := range installed {
				perms := ModulePermissions{
					Read:  mod.Permissions.Read,
					Write: mod.Permissions.Write,
					Net:   mod.Permissions.Net,
					Run:   mod.Permissions.Run,
				}
				if _, loadErr := s.LoadModule(mod.Code, mod.EntryPoint, perms); loadErr != nil {
					err = fmt.Errorf("coredeno: autoload %s: %w", mod.Code, loadErr)
					return err
				}
			}
		}
	}

	return nil
}

func loadAppManifest(medium io.Medium, pub ed25519.PublicKey) (*manifest.Manifest, error) {
	candidates := []string{
		".core/manifest.yaml",
		".core/view.yaml",
		".core/view.yml",
	}

	for _, path := range candidates {
		if !medium.Exists(path) {
			continue
		}

		data, err := medium.Read(path)
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", path, err)
		}

		m, err := manifest.Parse([]byte(data))
		if err != nil {
			return nil, fmt.Errorf("parse %s: %w", path, err)
		}

		if pub != nil {
			ok, verr := manifest.Verify(m, pub)
			if verr != nil {
				return nil, fmt.Errorf("verify %s: %w", path, verr)
			}
			if !ok {
				return nil, fmt.Errorf("verify %s: signature invalid", path)
			}
		}

		return m, nil
	}

	return nil, nil
}

// OnShutdown stops the CoreDeno subsystem. Called by the framework on app shutdown.
func (s *Service) OnShutdown(_ context.Context) error {
	if s.supervisorCancel != nil {
		s.supervisorCancel()
		if s.supervisorDone != nil {
			<-s.supervisorDone
		}
	}

	// Close Deno client connection
	s.closeDenoClient()

	// Stop sidecar
	_ = s.sidecar.Stop()

	// Stop gRPC listener
	if s.grpcCancel != nil {
		s.grpcCancel()
		<-s.grpcDone
	}

	// Close store
	if s.store != nil {
		s.store.Close()
	}

	s.grpcCancel = nil
	s.grpcDone = nil
	s.supervisorCancel = nil
	s.supervisorDone = nil
	s.denoClient = nil
	s.grpcServer = nil
	s.store = nil
	s.installer = nil

	return nil
}

// Sidecar returns the underlying sidecar for direct access.
func (s *Service) Sidecar() *Sidecar {
	return s.sidecar
}

// GRPCServer returns the gRPC server for direct access.
func (s *Service) GRPCServer() *Server {
	return s.grpcServer
}

// DenoClient returns the DenoService client for calling the Deno sidecar.
// Returns nil if the sidecar was not started or has no DenoSocketPath.
func (s *Service) DenoClient() *DenoClient {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.denoClient
}

// Installer returns the marketplace module installer.
// Returns nil if AppRoot was not set.
func (s *Service) Installer() *marketplace.Installer {
	return s.installer
}

// LoadModule registers module permissions on the Go side, then loads the module in Deno.
func (s *Service) LoadModule(code, entryPoint string, perms ModulePermissions) (*LoadModuleResponse, error) {
	if s.grpcServer == nil {
		return nil, fmt.Errorf("coredeno: gRPC server not started")
	}
	client := s.DenoClient()
	if client == nil {
		return nil, fmt.Errorf("coredeno: Deno client not connected")
	}

	s.grpcServer.RegisterModule(&manifest.Manifest{
		Code: code,
		Permissions: manifest.Permissions{
			Read:  perms.Read,
			Write: perms.Write,
			Net:   perms.Net,
			Run:   perms.Run,
		},
	})

	resp, err := client.LoadModule(code, entryPoint, perms)
	if err != nil {
		s.grpcServer.UnregisterModule(code)
		return nil, err
	}
	if resp.Ok {
		s.rememberModule(code, entryPoint, perms)
	} else {
		s.grpcServer.UnregisterModule(code)
	}
	return resp, nil
}

// UnloadModule unloads a module from the Deno runtime.
func (s *Service) UnloadModule(code string) (*UnloadModuleResponse, error) {
	client := s.DenoClient()
	if client == nil {
		return nil, fmt.Errorf("coredeno: Deno client not connected")
	}
	resp, err := client.UnloadModule(code)
	if err != nil {
		return nil, err
	}
	if resp.Ok {
		s.forgetModule(code)
	}
	return resp, nil
}

// ModuleStatus queries a module's status from the Deno runtime.
func (s *Service) ModuleStatus(code string) (*ModuleStatusResponse, error) {
	client := s.DenoClient()
	if client == nil {
		return nil, fmt.Errorf("coredeno: Deno client not connected")
	}
	return client.ModuleStatus(code)
}

func (s *Service) setDenoClient(client *DenoClient) {
	s.mu.Lock()
	old := s.denoClient
	s.denoClient = client
	s.mu.Unlock()

	if old != nil && old != client {
		_ = old.Close()
	}
}

func (s *Service) closeDenoClient() {
	s.setDenoClient(nil)
}

func (s *Service) cleanupStartupState() {
	s.closeDenoClient()

	if s.supervisorCancel != nil {
		s.supervisorCancel()
		if s.supervisorDone != nil {
			<-s.supervisorDone
		}
	}

	_ = s.sidecar.Stop()

	if s.grpcCancel != nil {
		s.grpcCancel()
		if s.grpcDone != nil {
			<-s.grpcDone
		}
	}

	if s.store != nil {
		s.store.Close()
	}

	s.grpcCancel = nil
	s.grpcDone = nil
	s.supervisorCancel = nil
	s.supervisorDone = nil
	s.grpcServer = nil
	s.installer = nil
	s.store = nil
}

func (s *Service) rememberModule(code, entryPoint string, perms ModulePermissions) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.desiredModules[code] = moduleSpec{
		EntryPoint:  entryPoint,
		Permissions: perms,
	}
}

func (s *Service) forgetModule(code string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.desiredModules, code)
}

func (s *Service) desiredModuleSnapshot() map[string]moduleSpec {
	s.mu.RLock()
	defer s.mu.RUnlock()

	snapshot := make(map[string]moduleSpec, len(s.desiredModules))
	for code, spec := range s.desiredModules {
		snapshot[code] = spec
	}
	return snapshot
}

func (s *Service) superviseSidecar(ctx context.Context) {
	defer close(s.supervisorDone)

	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !s.sidecar.IsRunning() {
				_ = s.restartSidecar(ctx)
				continue
			}

			client := s.DenoClient()
			if client == nil {
				_ = s.reconnectDeno(ctx)
				continue
			}
			if err := client.Ping(); err != nil {
				s.closeDenoClient()
				_ = s.reconnectDeno(ctx)
			}
		}
	}
}

func (s *Service) restartSidecar(ctx context.Context) error {
	s.closeDenoClient()

	opts := s.effectiveOptions()

	if err := s.sidecar.Start(ctx, opts.SidecarArgs...); err != nil {
		return err
	}

	if err := s.reconnectDeno(ctx); err != nil {
		_ = s.sidecar.Stop()
		return err
	}

	return nil
}

func (s *Service) reconnectDeno(ctx context.Context) error {
	if !s.shouldConnectDeno() {
		return nil
	}

	opts := s.effectiveOptions()

	dc, err := dialDenoReady(ctx, opts.DenoSocketPath, 10*time.Second)
	if err != nil {
		return err
	}
	s.setDenoClient(dc)

	return s.reloadDesiredModules()
}

func (s *Service) shouldConnectDeno() bool {
	opts := s.effectiveOptions()
	if opts.DenoSocketPath == "" {
		return false
	}
	if s.Options().DenoSocketPath != "" {
		return true
	}
	return looksLikeDenoRuntime(opts.SidecarArgs)
}

func looksLikeDenoRuntime(args []string) bool {
	for _, arg := range args {
		switch {
		case arg == "run":
			return true
		case strings.HasSuffix(arg, ".ts"):
			return true
		case strings.HasSuffix(arg, ".tsx"):
			return true
		case strings.HasSuffix(arg, ".js"):
			return true
		case strings.HasSuffix(arg, ".mjs"):
			return true
		case strings.HasSuffix(arg, ".cjs"):
			return true
		}
	}
	return false
}

func (s *Service) effectiveOptions() Options {
	if s.sidecar != nil {
		return s.sidecar.opts
	}
	return s.Options()
}

func (s *Service) reloadDesiredModules() error {
	client := s.DenoClient()
	if client == nil {
		return fmt.Errorf("coredeno: Deno client not connected")
	}

	for code, spec := range s.desiredModuleSnapshot() {
		resp, err := client.LoadModule(code, spec.EntryPoint, spec.Permissions)
		if err != nil {
			return err
		}
		if !resp.Ok {
			return fmt.Errorf("coredeno: reload %s: %s", code, resp.Error)
		}
	}
	return nil
}

func dialDenoReady(ctx context.Context, socketPath string, timeout time.Duration) (*DenoClient, error) {
	deadline := time.Now().Add(timeout)
	var lastErr error

	for time.Now().Before(deadline) {
		if err := waitForSocket(ctx, socketPath, 250*time.Millisecond); err == nil {
			client, err := DialDeno(socketPath)
			if err == nil {
				if pingErr := client.Ping(); pingErr == nil {
					return client, nil
				} else {
					lastErr = pingErr
				}
				_ = client.Close()
			} else {
				lastErr = err
			}
		} else if ctx.Err() != nil {
			return nil, ctx.Err()
		} else {
			lastErr = err
		}

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("timeout waiting for Deno sidecar")
	}
	return nil, lastErr
}

// waitForSocket polls until a Unix socket file appears or the context/timeout expires.
func waitForSocket(ctx context.Context, path string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		if _, err := os.Stat(path); err == nil {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("timeout waiting for socket %s", path)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(50 * time.Millisecond):
		}
	}
}

func waitForGRPCSocket(ctx context.Context, path string, timeout time.Duration, done <-chan error) error {
	deadline := time.Now().Add(timeout)
	for {
		if _, err := os.Stat(path); err == nil {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("timeout waiting for socket %s", path)
		}
		select {
		case err := <-done:
			if err != nil {
				return err
			}
			return fmt.Errorf("gRPC listener stopped before socket became ready")
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(50 * time.Millisecond):
		}
	}
}
