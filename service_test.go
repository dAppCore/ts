package ts

import (
	"bufio"
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	core "dappco.re/go/core"
	io "dappco.re/go/core/io"
	"dappco.re/go/core/io/store"
	"dappco.re/go/core/scm/manifest"
	pb "dappco.re/go/core/ts/proto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type manifestReadErrorMedium struct {
	*io.MockMedium
	path    string
	readErr string
}

func (m *manifestReadErrorMedium) Read(path string) (string, error) {
	if path == m.path {
		return "", errors.New(m.readErr)
	}
	return m.MockMedium.Read(path)
}

func TestNewServiceFactory_Good(t *testing.T) {
	opts := Options{
		DenoPath:   "echo",
		SocketPath: "/tmp/test-service.sock",
	}
	c := core.New()

	factory := NewServiceFactory(opts)
	result, err := factory(c)
	require.NoError(t, err)

	svc, ok := result.(*Service)
	require.True(t, ok)
	assert.NotNil(t, svc.sidecar)
	assert.Equal(t, "echo", svc.sidecar.opts.DenoPath)
	assert.NotNil(t, svc.Core(), "ServiceRuntime should provide Core access")
	assert.Equal(t, opts, svc.Options(), "ServiceRuntime should provide Options access")
}

func TestService_WithService_Good(t *testing.T) {
	c := core.New()
	result := c.Service("ts", core.Service{})
	assert.True(t, result.OK)
	assert.Contains(t, c.Services(), "ts")
}

func TestService_Lifecycle_Good(t *testing.T) {
	tmpDir := shortSocketDir(t)
	sockPath := filepath.Join(tmpDir, "lifecycle.sock")

	c := core.New()

	factory := NewServiceFactory(Options{
		DenoPath:   "echo",
		SocketPath: sockPath,
	})
	result, _ := factory(c)
	svc := result.(*Service)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Verify Startable
	err := svc.OnStartup(ctx)
	assert.NoError(t, err)

	// Verify Stoppable
	err = svc.OnShutdown(context.Background())
	assert.NoError(t, err)
}

func TestService_Sidecar_Good(t *testing.T) {
	c := core.New()

	factory := NewServiceFactory(Options{DenoPath: "echo"})
	result, _ := factory(c)
	svc := result.(*Service)

	assert.NotNil(t, svc.Sidecar())
}

func TestService_ShouldConnectDeno_Good_DefaultSocketPath(t *testing.T) {
	tmpDir := shortSocketDir(t)
	sockPath := filepath.Join(tmpDir, "core.sock")

	c := core.New()

	factory := NewServiceFactory(Options{
		DenoPath:    "echo",
		SocketPath:  sockPath,
		SidecarArgs: []string{"run", "main.ts"},
	})
	result, err := factory(c)
	require.NoError(t, err)
	svc := result.(*Service)

	assert.True(
		t,
		svc.shouldConnectDeno(),
		"service should honour the derived Deno socket path from the sidecar options",
	)
}

func TestService_ShouldConnectDeno_Bad_DummyProcess(t *testing.T) {
	tmpDir := shortSocketDir(t)
	sockPath := filepath.Join(tmpDir, "core.sock")

	c := core.New()

	factory := NewServiceFactory(Options{
		DenoPath:   "sleep",
		SocketPath: sockPath,
	})
	result, err := factory(c)
	require.NoError(t, err)
	svc := result.(*Service)

	assert.False(
		t,
		svc.shouldConnectDeno(),
		"dummy sidecar args should not trigger an eager Deno client connection",
	)
}

func TestService_OnStartup_Good(t *testing.T) {
	tmpDir := shortSocketDir(t)
	sockPath := filepath.Join(tmpDir, "core.sock")

	// Write a minimal manifest
	coreDir := filepath.Join(tmpDir, ".core")
	require.NoError(t, os.MkdirAll(coreDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(coreDir, "view.yml"), []byte(`
code: test-app
name: Test App
version: "1.0"
permissions:
  read: ["./data/"]
  write: ["./data/"]
`), 0644))
	require.NoError(t, os.MkdirAll(filepath.Join(coreDir, "locales"), 0755))
	require.NoError(t, os.WriteFile(filepath.Join(coreDir, "locales", "en.json"), []byte(`{"locale":"loaded"}`), 0644))

	opts := Options{
		DenoPath:    "sleep",
		SocketPath:  sockPath,
		AppRoot:     tmpDir,
		StoreDBPath: ":memory:",
		SidecarArgs: []string{"60"},
	}

	c := core.New()

	factory := NewServiceFactory(opts)
	result, err := factory(c)
	require.NoError(t, err)
	svc := result.(*Service)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	err = svc.OnStartup(ctx)
	require.NoError(t, err)

	// Verify socket appeared
	require.Eventually(t, func() bool {
		_, err := os.Stat(sockPath)
		return err == nil
	}, 2*time.Second, 10*time.Millisecond, "gRPC socket should appear after startup")

	// Verify gRPC responds
	conn, err := grpc.NewClient(
		"unix://"+sockPath,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	require.NoError(t, err)
	defer conn.Close()

	client := pb.NewCoreServiceClient(conn)
	pingResp, err := client.Ping(ctx, &pb.PingRequest{})
	require.NoError(t, err)
	assert.True(t, pingResp.Ok)

	_, err = client.StoreSet(ctx, &pb.StoreSetRequest{
		Group: "boot", Key: "ok", Value: "true",
	})
	require.NoError(t, err)

	resp, err := client.StoreGet(ctx, &pb.StoreGetRequest{
		Group: "boot", Key: "ok",
	})
	require.NoError(t, err)
	assert.True(t, resp.Found)
	assert.Equal(t, "true", resp.Value)

	localeResp, err := client.LocaleGet(ctx, &pb.LocaleGetRequest{Locale: "en"})
	require.NoError(t, err)
	assert.True(t, localeResp.Found)
	assert.Equal(t, `{"locale":"loaded"}`, localeResp.Content)

	// Verify sidecar is running
	assert.True(t, svc.sidecar.IsRunning(), "sidecar should be running")

	// Shutdown
	err = svc.OnShutdown(context.Background())
	assert.NoError(t, err)
	assert.False(t, svc.sidecar.IsRunning(), "sidecar should be stopped")
}

func TestService_OnStartup_Good_ConfiguresProcessRunner(t *testing.T) {
	tmpDir := shortSocketDir(t)
	sockPath := filepath.Join(tmpDir, "core.sock")

	c := core.New()

	factory := NewServiceFactory(Options{
		DenoPath:   "sleep",
		SocketPath: sockPath,
	})
	result, err := factory(c)
	require.NoError(t, err)
	svc := result.(*Service)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	err = svc.OnStartup(ctx)
	require.NoError(t, err)

	require.NotNil(t, svc.grpcServer)
	assert.NotNil(t, svc.grpcServer.processes, "startup should wire a process runner")

	err = svc.OnShutdown(context.Background())
	assert.NoError(t, err)
}

func TestLoadAppManifest_Good_PrefersViewManifest(t *testing.T) {
	medium := io.NewMockMedium()
	medium.Files[".core/view.yaml"] = `
code: view-app
name: View App
version: "1.0"
permissions:
  read: ["./view/"]
`
	medium.Files[".core/manifest.yaml"] = `
code: legacy-app
name: Legacy App
version: "9.9"
permissions:
  read: ["./legacy/"]
`

	m, err := loadAppManifest(medium, nil)
	require.NoError(t, err)
	require.NotNil(t, m)
	assert.Equal(t, "view-app", m.Code)
	assert.Equal(t, []string{"./view/"}, m.Permissions.Read)
}

func TestLoadAppManifest_Good_FallsBackToViewYML(t *testing.T) {
	medium := io.NewMockMedium()
	medium.Files[".core/view.yml"] = `
code: view-yml-app
name: View YML App
version: "1.0"
permissions:
  read: ["./yml/"]
`

	m, err := loadAppManifest(medium, nil)
	require.NoError(t, err)
	require.NotNil(t, m)
	assert.Equal(t, "view-yml-app", m.Code)
	assert.Equal(t, []string{"./yml/"}, m.Permissions.Read)
}

func TestLoadAppManifest_Bad_ParseError(t *testing.T) {
	medium := io.NewMockMedium()
	medium.Files[".core/view.yaml"] = `
code: broken
permissions:
  read: ["
`

	m, err := loadAppManifest(medium, nil)
	require.Error(t, err)
	assert.Nil(t, m)
	assert.Contains(t, err.Error(), "parse .core/view.yaml")
}

func TestService_OnStartup_Good_DefaultSocketPath(t *testing.T) {
	tmpDir := shortSocketDir(t)
	t.Setenv("XDG_RUNTIME_DIR", tmpDir)

	c := core.New()

	factory := NewServiceFactory(Options{
		DenoPath: "sleep",
	})
	result, err := factory(c)
	require.NoError(t, err)
	svc := result.(*Service)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	err = svc.OnStartup(ctx)
	require.NoError(t, err)

	sockPath := filepath.Join(tmpDir, "core", "core.sock")
	if runtime.GOOS == "darwin" {
		sockPath = filepath.Join("/tmp", "core", "core.sock")
	}
	require.Eventually(t, func() bool {
		_, err := os.Stat(sockPath)
		return err == nil
	}, 2*time.Second, 10*time.Millisecond, "default gRPC socket should appear")

	err = svc.OnShutdown(context.Background())
	assert.NoError(t, err)
}

func TestService_OnStartup_Good_NoManifest(t *testing.T) {
	tmpDir := shortSocketDir(t)
	sockPath := filepath.Join(tmpDir, "core.sock")

	opts := Options{
		DenoPath:    "sleep",
		SocketPath:  sockPath,
		AppRoot:     tmpDir,
		StoreDBPath: ":memory:",
	}

	c := core.New()

	factory := NewServiceFactory(opts)
	result, _ := factory(c)
	svc := result.(*Service)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Should succeed even without .core/view.yml
	err := svc.OnStartup(ctx)
	require.NoError(t, err)

	err = svc.OnShutdown(context.Background())
	assert.NoError(t, err)
}

func TestService_OnStartup_Good_LegacyManifest(t *testing.T) {
	tmpDir := shortSocketDir(t)
	sockPath := filepath.Join(tmpDir, "core.sock")

	coreDir := filepath.Join(tmpDir, ".core")
	require.NoError(t, os.MkdirAll(coreDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(coreDir, "view.yml"), []byte(`
code: legacy-app
name: Legacy App
version: "1.0"
permissions:
  read: ["./data/"]
`), 0644))
	require.NoError(t, os.MkdirAll(filepath.Join(tmpDir, "data"), 0755))
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "data", "test.txt"), []byte("hello"), 0644))

	opts := Options{
		DenoPath:    "sleep",
		SocketPath:  sockPath,
		AppRoot:     tmpDir,
		StoreDBPath: ":memory:",
	}

	c := core.New()
	factory := NewServiceFactory(opts)
	result, err := factory(c)
	require.NoError(t, err)
	svc := result.(*Service)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	err = svc.OnStartup(ctx)
	require.NoError(t, err)

	resp, err := svc.GRPCServer().FileRead(context.Background(), &pb.FileReadRequest{
		Path:       "./data/test.txt",
		ModuleCode: "legacy-app",
	})
	require.NoError(t, err)
	assert.Equal(t, "hello", resp.Content)

	err = svc.OnShutdown(context.Background())
	assert.NoError(t, err)
}

func TestService_LoadModule_Bad_RollsBackManifest(t *testing.T) {
	tmpDir := shortSocketDir(t)
	sockPath := filepath.Join(tmpDir, "deno.sock")

	listener, err := net.Listen("unix", sockPath)
	require.NoError(t, err)
	t.Cleanup(func() { _ = listener.Close() })

	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()

		decoder := json.NewDecoder(conn)
		encoder := json.NewEncoder(conn)

		var req map[string]any
		if err := decoder.Decode(&req); err != nil {
			return
		}

		_ = encoder.Encode(map[string]any{
			"ok": false,
		})
	}()

	client, err := DialDeno(sockPath)
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.Close() })

	st, err := store.New(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { _ = st.Close() })

	svc := &Service{
		grpcServer: NewServer(io.NewMockMedium(), st),
	}
	svc.setDenoClient(client)

	resp, err := svc.LoadModule("bad-mod", filepath.Join(tmpDir, "module.ts"), ModulePermissions{
		Read: []string{"./data/"},
	})
	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.False(t, resp.Ok)

	_, err = svc.GRPCServer().FileRead(context.Background(), &pb.FileReadRequest{
		Path:       "./data/test.txt",
		ModuleCode: "bad-mod",
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unknown module")
}

func TestService_LoadModule_Bad_RejectsBlankIdentity(t *testing.T) {
	st, err := store.New(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { st.Close() })

	svc := &Service{
		grpcServer: NewServer(io.NewMockMedium(), st),
	}
	svc.setDenoClient(&DenoClient{})

	_, loadErr := svc.LoadModule("  ", "file:///module.ts", ModulePermissions{})
	require.Error(t, loadErr)
	assert.Contains(t, loadErr.Error(), "module code required")

	_, loadErr = svc.LoadModule("module", "   ", ModulePermissions{})
	require.Error(t, loadErr)
	assert.Contains(t, loadErr.Error(), "module entry point required")
}

func TestService_UnloadModule_Good_UnregistersManifest(t *testing.T) {
	tmpDir := shortSocketDir(t)
	sockPath := filepath.Join(tmpDir, "deno.sock")

	listener, err := net.Listen("unix", sockPath)
	require.NoError(t, err)
	t.Cleanup(func() { _ = listener.Close() })

	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()

		decoder := json.NewDecoder(conn)
		encoder := json.NewEncoder(conn)

		var req map[string]any
		if err := decoder.Decode(&req); err != nil {
			return
		}

		_ = encoder.Encode(map[string]any{
			"ok": true,
		})
	}()

	client, err := DialDeno(sockPath)
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.Close() })

	st, err := store.New(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { _ = st.Close() })

	svc := &Service{
		grpcServer: NewServer(io.NewMockMedium(), st),
	}
	svc.setDenoClient(client)
	svc.grpcServer.RegisterModule(&manifest.Manifest{
		Code: "good-mod",
		Permissions: manifest.Permissions{
			Read: []string{"./data/"},
		},
	})
	svc.rememberModule("good-mod", filepath.Join(tmpDir, "module.ts"), ModulePermissions{
		Read: []string{"./data/"},
	})

	resp, err := svc.UnloadModule("good-mod")
	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.True(t, resp.Ok)

	_, err = svc.GRPCServer().FileRead(context.Background(), &pb.FileReadRequest{
		Path:       "./data/test.txt",
		ModuleCode: "good-mod",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown module")
}

func TestService_OnStartup_Bad_InvalidManifestSignature(t *testing.T) {
	tmpDir := shortSocketDir(t)
	sockPath := filepath.Join(tmpDir, "core.sock")

	coreDir := filepath.Join(tmpDir, ".core")
	require.NoError(t, os.MkdirAll(coreDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(coreDir, "view.yml"), []byte(`
code: signed-app
name: Signed App
version: "1.0"
sign: invalid-signature
permissions:
  read: ["./data/"]
`), 0644))

	pub, _, err := ed25519.GenerateKey(nil)
	require.NoError(t, err)

	opts := Options{
		DenoPath:    "sleep",
		SocketPath:  sockPath,
		AppRoot:     tmpDir,
		StoreDBPath: ":memory:",
		PublicKey:   pub,
	}

	c := core.New()
	factory := NewServiceFactory(opts)
	result, err := factory(c)
	require.NoError(t, err)
	svc := result.(*Service)

	err = svc.OnStartup(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "manifest")
}

func TestLooksLikeDenoRuntime_Good(t *testing.T) {
	assert.True(t, looksLikeDenoRuntime([]string{"run", "main.ts"}))
	assert.True(t, looksLikeDenoRuntime([]string{"deno", "script.mjs"}))
	assert.True(t, looksLikeDenoRuntime([]string{"build", "worker.tsx"}))
}

func TestLooksLikeDenoRuntime_Bad(t *testing.T) {
	assert.False(t, looksLikeDenoRuntime([]string{"sleep", "10"}))
	assert.False(t, looksLikeDenoRuntime([]string{"sh", "-c", "echo hi"}))
}

func TestLooksLikeDenoRuntime_Ugly_EmptyArgs(t *testing.T) {
	assert.False(t, looksLikeDenoRuntime(nil))
	assert.False(t, looksLikeDenoRuntime([]string{}))
}

func TestService_waitForSocket_Good_Appears(t *testing.T) {
	path := filepath.Join(t.TempDir(), "core.sock")

	go func() {
		time.Sleep(50 * time.Millisecond)
		_ = os.WriteFile(path, []byte("socket"), 0600)
	}()

	require.NoError(t, waitForSocket(context.Background(), path, time.Second))
}

func TestService_waitForSocket_Bad_Timeout(t *testing.T) {
	path := filepath.Join(t.TempDir(), "core.sock")

	err := waitForSocket(context.Background(), path, 20*time.Millisecond)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "timeout waiting for socket")
}

func TestService_waitForSocket_Ugly_Cancelled(t *testing.T) {
	path := filepath.Join(t.TempDir(), "core.sock")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := waitForSocket(ctx, path, time.Second)
	require.Error(t, err)
	assert.ErrorIs(t, err, context.Canceled)
}

func TestService_waitForGRPCSocket_Good_Appears(t *testing.T) {
	path := filepath.Join(t.TempDir(), "core.sock")
	done := make(chan error)

	go func() {
		time.Sleep(50 * time.Millisecond)
		_ = os.WriteFile(path, []byte("socket"), 0600)
	}()

	require.NoError(t, waitForGRPCSocket(context.Background(), path, time.Second, done))
}

func TestService_waitForGRPCSocket_Bad_DoneError(t *testing.T) {
	path := filepath.Join(t.TempDir(), "core.sock")
	done := make(chan error, 1)
	done <- errors.New("listener failed")

	err := waitForGRPCSocket(context.Background(), path, time.Second, done)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "listener failed")
}

func TestService_waitForGRPCSocket_Ugly_Cancelled(t *testing.T) {
	path := filepath.Join(t.TempDir(), "core.sock")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	done := make(chan error)

	err := waitForGRPCSocket(ctx, path, time.Second, done)
	require.Error(t, err)
	assert.ErrorIs(t, err, context.Canceled)
}

func TestService_reloadDesiredModules_Good(t *testing.T) {
	left, right := net.Pipe()
	defer right.Close()

	client := &DenoClient{
		conn:   left,
		reader: bufio.NewReader(left),
	}

	scriptJSONRPC(t, right, func(req map[string]any) {
		assert.Equal(t, "LoadModule", req["method"])
		assert.Equal(t, "mod-1", req["code"])
		assert.Equal(t, "file:///module.ts", req["entry_point"])
	}, map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"result": map[string]any{
			"ok": true,
		},
	})

	svc := &Service{}
	svc.setDenoClient(client)
	svc.rememberModule("mod-1", "file:///module.ts", ModulePermissions{
		Read: []string{"./data/"},
	})

	require.NoError(t, svc.reloadDesiredModules())
}

func TestService_reloadDesiredModules_Bad_RemoteRejects(t *testing.T) {
	left, right := net.Pipe()
	defer right.Close()

	client := &DenoClient{
		conn:   left,
		reader: bufio.NewReader(left),
	}

	scriptJSONRPC(t, right, func(req map[string]any) {
		assert.Equal(t, "LoadModule", req["method"])
		assert.Equal(t, "mod-1", req["code"])
	}, map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"result": map[string]any{
			"ok":    false,
			"error": "load rejected",
		},
	})

	svc := &Service{}
	svc.setDenoClient(client)
	svc.rememberModule("mod-1", "file:///module.ts", ModulePermissions{})

	err := svc.reloadDesiredModules()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "reload mod-1")
	assert.Contains(t, err.Error(), "load rejected")
}

func TestService_reloadDesiredModules_Ugly_NoClient(t *testing.T) {
	svc := &Service{}
	svc.rememberModule("mod-1", "file:///module.ts", ModulePermissions{})

	err := svc.reloadDesiredModules()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Deno client not connected")
}

func TestService_OnStartup_Bad_CleansUpState(t *testing.T) {
	tmpDir := shortSocketDir(t)
	sockPath := filepath.Join(tmpDir, "core.sock")

	coreDir := filepath.Join(tmpDir, ".core")
	require.NoError(t, os.MkdirAll(coreDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(coreDir, "view.yml"), []byte(`
code: cleanup-app
name: Cleanup App
version: "1.0"
sign: invalid-signature
permissions:
  read: ["./data/"]
`), 0644))

	pub, _, err := ed25519.GenerateKey(nil)
	require.NoError(t, err)

	opts := Options{
		DenoPath:    "sleep",
		SocketPath:  sockPath,
		AppRoot:     tmpDir,
		StoreDBPath: ":memory:",
		SidecarArgs: []string{"60"},
		PublicKey:   pub,
	}

	c := core.New()
	factory := NewServiceFactory(opts)
	result, err := factory(c)
	require.NoError(t, err)
	svc := result.(*Service)

	err = svc.OnStartup(context.Background())
	require.Error(t, err)

	assert.Nil(t, svc.store)
	assert.Nil(t, svc.grpcServer)
	assert.Nil(t, svc.grpcCancel)
	assert.Nil(t, svc.grpcDone)
	assert.Nil(t, svc.denoClient)
	assert.Nil(t, svc.installer)
	assert.False(t, svc.sidecar.IsRunning())
}

func TestService_OnStartup_Good_RestartsExitedSidecar(t *testing.T) {
	tmpDir := shortSocketDir(t)
	sockPath := filepath.Join(tmpDir, "core.sock")
	restartLog := filepath.Join(tmpDir, "restart.log")

	opts := Options{
		DenoPath:    "sh",
		SocketPath:  sockPath,
		StoreDBPath: ":memory:",
		SidecarArgs: []string{
			"-c",
			"echo restart >> " + restartLog + "; sleep 0.1; exit 1",
		},
	}

	c := core.New()

	factory := NewServiceFactory(opts)
	result, err := factory(c)
	require.NoError(t, err)
	svc := result.(*Service)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err = svc.OnStartup(ctx)
	require.NoError(t, err)

	require.Eventually(t, func() bool {
		data, err := os.ReadFile(restartLog)
		if err != nil {
			return false
		}
		return strings.Count(string(data), "restart") >= 2
	}, 3*time.Second, 100*time.Millisecond, "sidecar should restart after unexpected exit")

	err = svc.OnShutdown(context.Background())
	require.NoError(t, err)
}

func TestLoadAppManifest_Good_VerifiesSignedManifest(t *testing.T) {
	medium := io.NewMockMedium()
	manifestDoc := &manifest.Manifest{
		Code:    "signed-app",
		Name:    "Signed App",
		Version: "1.0",
		Permissions: manifest.Permissions{
			Read: []string{"./data/"},
		},
	}

	pub, priv, err := ed25519.GenerateKey(nil)
	require.NoError(t, err)
	require.NoError(t, manifest.Sign(manifestDoc, priv))

	yamlBytes, err := manifest.MarshalYAML(manifestDoc)
	require.NoError(t, err)
	medium.Files[".core/view.yaml"] = string(yamlBytes)

	got, err := loadAppManifest(medium, pub)
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "signed-app", got.Code)
	assert.Equal(t, manifestDoc.Sign, got.Sign)
}

func TestLoadAppManifest_Bad_ReadError(t *testing.T) {
	medium := &manifestReadErrorMedium{
		MockMedium: io.NewMockMedium(),
		path:       ".core/view.yaml",
		readErr:    "manifest disk error",
	}
	medium.Files[medium.path] = "code: broken"

	got, err := loadAppManifest(medium, nil)
	require.Error(t, err)
	assert.Nil(t, got)
	assert.Contains(t, err.Error(), "read .core/view.yaml")
	assert.Contains(t, err.Error(), "manifest disk error")
}

func TestLoadAppManifest_Ugly_VerifyMismatch(t *testing.T) {
	medium := io.NewMockMedium()
	manifestDoc := &manifest.Manifest{
		Code:    "signed-app",
		Name:    "Signed App",
		Version: "1.0",
	}

	_, priv, err := ed25519.GenerateKey(nil)
	require.NoError(t, err)
	require.NoError(t, manifest.Sign(manifestDoc, priv))

	yamlBytes, err := manifest.MarshalYAML(manifestDoc)
	require.NoError(t, err)
	medium.Files[".core/view.yaml"] = string(yamlBytes)

	badPub, _, err := ed25519.GenerateKey(nil)
	require.NoError(t, err)

	got, err := loadAppManifest(medium, badPub)
	require.Error(t, err)
	assert.Nil(t, got)
	assert.Contains(t, err.Error(), "verify .core/view.yaml")
}

func TestService_LoadModule_Good_RegistersManifest(t *testing.T) {
	left, right := net.Pipe()
	defer right.Close()

	client := &DenoClient{
		conn:   left,
		reader: bufio.NewReader(left),
	}

	scriptJSONRPC(t, right, func(req map[string]any) {
		assert.Equal(t, "LoadModule", req["method"])
		assert.Equal(t, "good-mod", req["code"])
		assert.Equal(t, "file:///module.ts", req["entry_point"])
	}, map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"result": map[string]any{
			"ok": true,
		},
	})

	medium := io.NewMockMedium()
	medium.Files["./data/test.txt"] = "hello"
	st, err := store.New(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { st.Close() })

	svc := &Service{
		grpcServer: NewServer(medium, st),
	}
	svc.setDenoClient(client)

	resp, err := svc.LoadModule("good-mod", "file:///module.ts", ModulePermissions{
		Read: []string{"./data/"},
	})
	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.True(t, resp.Ok)

	fileResp, err := svc.GRPCServer().FileRead(context.Background(), &pb.FileReadRequest{
		Path:       "./data/test.txt",
		ModuleCode: "good-mod",
	})
	require.NoError(t, err)
	assert.Equal(t, "hello", fileResp.Content)
}

func TestService_LoadModule_Bad_NoClient(t *testing.T) {
	st, err := store.New(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { st.Close() })

	svc := &Service{
		grpcServer: NewServer(io.NewMockMedium(), st),
	}

	_, err = svc.LoadModule("good-mod", "file:///module.ts", ModulePermissions{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Deno client not connected")
}

func TestService_ModuleStatus_Good(t *testing.T) {
	left, right := net.Pipe()
	defer right.Close()

	client := &DenoClient{
		conn:   left,
		reader: bufio.NewReader(left),
	}

	scriptJSONRPC(t, right, func(req map[string]any) {
		assert.Equal(t, "ModuleStatus", req["method"])
		assert.Equal(t, "mod-1", req["code"])
	}, map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"result": map[string]any{
			"code":   "mod-1",
			"status": "RUNNING",
		},
	})

	svc := &Service{}
	svc.setDenoClient(client)

	resp, err := svc.ModuleStatus("mod-1")
	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.Equal(t, "mod-1", resp.Code)
	assert.Equal(t, "RUNNING", resp.Status)
}

func TestService_ModuleStatus_Bad_NoClient(t *testing.T) {
	svc := &Service{}

	_, err := svc.ModuleStatus("mod-1")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Deno client not connected")
}

func TestService_ReloadModules_Good(t *testing.T) {
	left, right := net.Pipe()
	defer right.Close()

	client := &DenoClient{
		conn:   left,
		reader: bufio.NewReader(left),
	}

	scriptJSONRPC(t, right, func(req map[string]any) {
		assert.Equal(t, "ReloadModules", req["method"])
	}, map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"result": map[string]any{
			"ok": true,
			"results": []any{
				map[string]any{"ok": true},
				map[string]any{"ok": false, "error": "reload rejected"},
			},
		},
	})

	svc := &Service{}
	svc.setDenoClient(client)

	resp, err := svc.ReloadModules()
	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.True(t, resp.Ok)
	require.Len(t, resp.Results, 2)
	assert.True(t, resp.Results[0].Ok)
	assert.False(t, resp.Results[1].Ok)
	assert.Equal(t, "reload rejected", resp.Results[1].Error)
}

func TestService_ReloadModules_Bad_NoClient(t *testing.T) {
	svc := &Service{}

	_, err := svc.ReloadModules()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Deno client not connected")
}

func TestService_ShouldConnectDeno_Good_ExplicitSocketPath(t *testing.T) {
	tmpDir := shortSocketDir(t)
	sockPath := filepath.Join(tmpDir, "core.sock")
	denoSockPath := filepath.Join(tmpDir, "deno.sock")

	c := core.New()
	factory := NewServiceFactory(Options{
		DenoPath:       "sleep",
		SocketPath:     sockPath,
		DenoSocketPath: denoSockPath,
		SidecarArgs:    []string{"10"},
	})
	result, err := factory(c)
	require.NoError(t, err)
	svc := result.(*Service)

	assert.True(t, svc.shouldConnectDeno())
}

func TestService_dialDenoReady_Good(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "deno.sock")
	listener, err := net.Listen("unix", sockPath)
	require.NoError(t, err)
	t.Cleanup(func() { _ = listener.Close() })

	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()

		reader := bufio.NewReader(conn)
		line, err := reader.ReadBytes('\n')
		if err != nil {
			return
		}

		var req map[string]any
		if err := json.Unmarshal(line, &req); err != nil {
			return
		}

		resp := map[string]any{
			"jsonrpc": "2.0",
			"id":      req["id"],
			"result": map[string]any{
				"ok": true,
			},
		}
		if err := json.NewEncoder(conn).Encode(resp); err != nil {
			return
		}
	}()

	client, err := dialDenoReady(context.Background(), sockPath, time.Second)
	require.NoError(t, err)
	require.NotNil(t, client)
	t.Cleanup(func() { _ = client.Close() })
}

func TestService_dialDenoReady_Bad_Timeout(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "missing.sock")

	_, err := dialDenoReady(context.Background(), sockPath, 25*time.Millisecond)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "timeout waiting for")
}

func TestService_dialDenoReady_Ugly_Cancelled(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "missing.sock")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := dialDenoReady(ctx, sockPath, time.Second)
	require.Error(t, err)
	assert.ErrorIs(t, err, context.Canceled)
}
