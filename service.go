package ts

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	io "forge.lthn.ai/core/go-io"
	"forge.lthn.ai/core/go-io/store"
	"forge.lthn.ai/core/go-scm/manifest"
	"forge.lthn.ai/core/go-scm/marketplace"
	core "forge.lthn.ai/core/go/pkg/core"
)

// Service wraps the CoreDeno sidecar as a framework service.
// Implements Startable and Stoppable for lifecycle management.
//
// Registration:
//
//	core.New(core.WithService(coredeno.NewServiceFactory(opts)))
type Service struct {
	*core.ServiceRuntime[Options]
	sidecar    *Sidecar
	grpcServer *Server
	store      *store.Store
	grpcCancel context.CancelFunc
	grpcDone   chan error
	denoClient *DenoClient
	installer  *marketplace.Installer
}

// NewServiceFactory returns a factory function for framework registration via WithService.
func NewServiceFactory(opts Options) func(*core.Core) (any, error) {
	return func(c *core.Core) (any, error) {
		return &Service{
			ServiceRuntime: core.NewServiceRuntime(c, opts),
			sidecar:        NewSidecar(opts),
		}, nil
	}
}

// OnStartup boots the CoreDeno subsystem. Called by the framework on app startup.
//
// Sequence: medium → store → server → manifest → gRPC listener → sidecar.
func (s *Service) OnStartup(ctx context.Context) error {
	opts := s.Opts()

	// 1. Create sandboxed Medium (or mock if no AppRoot)
	var medium io.Medium
	if opts.AppRoot != "" {
		var err error
		medium, err = io.NewSandboxed(opts.AppRoot)
		if err != nil {
			return fmt.Errorf("coredeno: medium: %w", err)
		}
	} else {
		medium = io.NewMockMedium()
	}

	// 2. Create Store
	dbPath := opts.StoreDBPath
	if dbPath == "" {
		dbPath = ":memory:"
	}
	var err error
	s.store, err = store.New(dbPath)
	if err != nil {
		return fmt.Errorf("coredeno: store: %w", err)
	}

	// 3. Create gRPC Server
	s.grpcServer = NewServer(medium, s.store)

	// 4. Load manifest if AppRoot set (non-fatal if missing)
	if opts.AppRoot != "" {
		m, loadErr := manifest.Load(medium, ".")
		if loadErr == nil && m != nil {
			if opts.PublicKey != nil {
				if ok, verr := manifest.Verify(m, opts.PublicKey); verr == nil && ok {
					s.grpcServer.RegisterModule(m)
				}
			} else {
				s.grpcServer.RegisterModule(m)
			}
		}
	}

	// 5. Start gRPC listener in background
	grpcCtx, grpcCancel := context.WithCancel(ctx)
	s.grpcCancel = grpcCancel
	s.grpcDone = make(chan error, 1)
	go func() {
		s.grpcDone <- ListenGRPC(grpcCtx, opts.SocketPath, s.grpcServer)
	}()

	// cleanupGRPC tears down the listener on early-return errors.
	cleanupGRPC := func() {
		grpcCancel()
		<-s.grpcDone
	}

	// 6. Start sidecar (if args provided)
	if len(opts.SidecarArgs) > 0 {
		// Wait for core socket so sidecar can connect to our gRPC server
		if err := waitForSocket(ctx, opts.SocketPath, 5*time.Second); err != nil {
			cleanupGRPC()
			return fmt.Errorf("coredeno: core socket: %w", err)
		}

		if err := s.sidecar.Start(ctx, opts.SidecarArgs...); err != nil {
			cleanupGRPC()
			return fmt.Errorf("coredeno: sidecar: %w", err)
		}

		// 7. Wait for Deno's server and connect as client
		if opts.DenoSocketPath != "" {
			if err := waitForSocket(ctx, opts.DenoSocketPath, 10*time.Second); err != nil {
				_ = s.sidecar.Stop()
				cleanupGRPC()
				return fmt.Errorf("coredeno: deno socket: %w", err)
			}
			dc, err := DialDeno(opts.DenoSocketPath)
			if err != nil {
				_ = s.sidecar.Stop()
				cleanupGRPC()
				return fmt.Errorf("coredeno: deno client: %w", err)
			}
			s.denoClient = dc
		}
	}

	// 8. Create installer and auto-load installed modules
	if opts.AppRoot != "" {
		modulesDir := filepath.Join(opts.AppRoot, "modules")
		s.installer = marketplace.NewInstaller(medium, modulesDir, s.store)

		if s.denoClient != nil {
			installed, listErr := s.installer.Installed()
			if listErr == nil {
				for _, mod := range installed {
					perms := ModulePermissions{
						Read:  mod.Permissions.Read,
						Write: mod.Permissions.Write,
						Net:   mod.Permissions.Net,
						Run:   mod.Permissions.Run,
					}
					s.denoClient.LoadModule(mod.Code, mod.EntryPoint, perms)
				}
			}
		}
	}

	return nil
}

// OnShutdown stops the CoreDeno subsystem. Called by the framework on app shutdown.
func (s *Service) OnShutdown(_ context.Context) error {
	// Close Deno client connection
	if s.denoClient != nil {
		s.denoClient.Close()
	}

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
	return s.denoClient
}

// Installer returns the marketplace module installer.
// Returns nil if AppRoot was not set.
func (s *Service) Installer() *marketplace.Installer {
	return s.installer
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
