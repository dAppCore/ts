package ts

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	pb "forge.lthn.ai/core/ts/proto"
	core "forge.lthn.ai/core/go/pkg/core"
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
	c, err := core.New()
	require.NoError(t, err)

	factory := NewServiceFactory(opts)
	result, err := factory(c)
	require.NoError(t, err)

	svc, ok := result.(*Service)
	require.True(t, ok)
	assert.NotNil(t, svc.sidecar)
	assert.Equal(t, "echo", svc.sidecar.opts.DenoPath)
	assert.NotNil(t, svc.Core(), "ServiceRuntime should provide Core access")
	assert.Equal(t, opts, svc.Opts(), "ServiceRuntime should provide Options access")
}

func TestService_WithService_Good(t *testing.T) {
	opts := Options{DenoPath: "echo"}
	c, err := core.New(core.WithService(NewServiceFactory(opts)))
	require.NoError(t, err)
	assert.NotNil(t, c)
}

func TestService_Lifecycle_Good(t *testing.T) {
	tmpDir := t.TempDir()
	sockPath := filepath.Join(tmpDir, "lifecycle.sock")

	c, err := core.New()
	require.NoError(t, err)

	factory := NewServiceFactory(Options{
		DenoPath:   "echo",
		SocketPath: sockPath,
	})
	result, _ := factory(c)
	svc := result.(*Service)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Verify Startable
	err = svc.OnStartup(ctx)
	assert.NoError(t, err)

	// Verify Stoppable
	err = svc.OnShutdown(context.Background())
	assert.NoError(t, err)
}

func TestService_Sidecar_Good(t *testing.T) {
	c, err := core.New()
	require.NoError(t, err)

	factory := NewServiceFactory(Options{DenoPath: "echo"})
	result, _ := factory(c)
	svc := result.(*Service)

	assert.NotNil(t, svc.Sidecar())
}

func TestService_OnStartup_Good(t *testing.T) {
	tmpDir := t.TempDir()
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

	opts := Options{
		DenoPath:    "sleep",
		SocketPath:  sockPath,
		AppRoot:     tmpDir,
		StoreDBPath: ":memory:",
		SidecarArgs: []string{"60"},
	}

	c, err := core.New()
	require.NoError(t, err)

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

	// Verify sidecar is running
	assert.True(t, svc.sidecar.IsRunning(), "sidecar should be running")

	// Shutdown
	err = svc.OnShutdown(context.Background())
	assert.NoError(t, err)
	assert.False(t, svc.sidecar.IsRunning(), "sidecar should be stopped")
}

func TestService_OnStartup_Good_NoManifest(t *testing.T) {
	tmpDir := t.TempDir()
	sockPath := filepath.Join(tmpDir, "core.sock")

	opts := Options{
		DenoPath:    "sleep",
		SocketPath:  sockPath,
		AppRoot:     tmpDir,
		StoreDBPath: ":memory:",
	}

	c, err := core.New()
	require.NoError(t, err)

	factory := NewServiceFactory(opts)
	result, _ := factory(c)
	svc := result.(*Service)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Should succeed even without .core/view.yml
	err = svc.OnStartup(ctx)
	require.NoError(t, err)

	err = svc.OnShutdown(context.Background())
	assert.NoError(t, err)
}
