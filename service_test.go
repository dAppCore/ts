package ts

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
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
