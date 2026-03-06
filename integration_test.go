//go:build integration

package ts

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	pb "forge.lthn.ai/core/ts/proto"
	core "forge.lthn.ai/core/go/pkg/core"
	"forge.lthn.ai/core/go-scm/marketplace"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// unused import guard
var _ = pb.NewCoreServiceClient

func findDeno(t *testing.T) string {
	t.Helper()
	denoPath, err := exec.LookPath("deno")
	if err != nil {
		home, _ := os.UserHomeDir()
		denoPath = filepath.Join(home, ".deno", "bin", "deno")
		if _, err := os.Stat(denoPath); err != nil {
			t.Skip("deno not installed")
		}
	}
	return denoPath
}

// runtimeEntryPoint returns the absolute path to runtime/main.ts.
func runtimeEntryPoint(t *testing.T) string {
	t.Helper()
	// We're in pkg/coredeno/ during test, runtime is a subdir
	abs, err := filepath.Abs("runtime/main.ts")
	require.NoError(t, err)
	require.FileExists(t, abs)
	return abs
}

// testModulePath returns the absolute path to runtime/testdata/test-module.ts.
func testModulePath(t *testing.T) string {
	t.Helper()
	abs, err := filepath.Abs("runtime/testdata/test-module.ts")
	require.NoError(t, err)
	require.FileExists(t, abs)
	return abs
}

func TestIntegration_FullBoot_Good(t *testing.T) {
	denoPath := findDeno(t)

	tmpDir := t.TempDir()
	sockPath := filepath.Join(tmpDir, "core.sock")

	// Write a manifest
	coreDir := filepath.Join(tmpDir, ".core")
	require.NoError(t, os.MkdirAll(coreDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(coreDir, "view.yml"), []byte(`
code: integration-test
name: Integration Test
version: "1.0"
permissions:
  read: ["./data/"]
`), 0644))

	entryPoint := runtimeEntryPoint(t)

	opts := Options{
		DenoPath:    denoPath,
		SocketPath:  sockPath,
		AppRoot:     tmpDir,
		StoreDBPath: ":memory:",
		SidecarArgs: []string{"run", "-A", entryPoint},
	}

	c, err := core.New()
	require.NoError(t, err)

	factory := NewServiceFactory(opts)
	result, err := factory(c)
	require.NoError(t, err)
	svc := result.(*Service)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	err = svc.OnStartup(ctx)
	require.NoError(t, err)

	// Verify gRPC is working
	require.Eventually(t, func() bool {
		_, err := os.Stat(sockPath)
		return err == nil
	}, 5*time.Second, 50*time.Millisecond, "socket should appear")

	conn, err := grpc.NewClient(
		"unix://"+sockPath,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	require.NoError(t, err)
	defer conn.Close()

	client := pb.NewCoreServiceClient(conn)
	_, err = client.StoreSet(ctx, &pb.StoreSetRequest{
		Group: "integration", Key: "boot", Value: "ok",
	})
	require.NoError(t, err)

	resp, err := client.StoreGet(ctx, &pb.StoreGetRequest{
		Group: "integration", Key: "boot",
	})
	require.NoError(t, err)
	assert.Equal(t, "ok", resp.Value)
	assert.True(t, resp.Found)

	// Verify sidecar is running
	assert.True(t, svc.sidecar.IsRunning(), "Deno sidecar should be running")

	// Clean shutdown
	err = svc.OnShutdown(context.Background())
	assert.NoError(t, err)
	assert.False(t, svc.sidecar.IsRunning(), "Deno sidecar should be stopped")
}

func TestIntegration_Tier2_Bidirectional_Good(t *testing.T) {
	denoPath := findDeno(t)

	tmpDir := t.TempDir()
	sockPath := filepath.Join(tmpDir, "core.sock")
	denoSockPath := filepath.Join(tmpDir, "deno.sock")

	// Write a manifest
	coreDir := filepath.Join(tmpDir, ".core")
	require.NoError(t, os.MkdirAll(coreDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(coreDir, "view.yml"), []byte(`
code: tier2-test
name: Tier 2 Test
version: "1.0"
permissions:
  read: ["./data/"]
  run: ["echo"]
`), 0644))

	entryPoint := runtimeEntryPoint(t)

	opts := Options{
		DenoPath:       denoPath,
		SocketPath:     sockPath,
		DenoSocketPath: denoSockPath,
		AppRoot:        tmpDir,
		StoreDBPath:    ":memory:",
		SidecarArgs:    []string{"run", "-A", "--unstable-worker-options", entryPoint},
	}

	c, err := core.New()
	require.NoError(t, err)

	factory := NewServiceFactory(opts)
	result, err := factory(c)
	require.NoError(t, err)
	svc := result.(*Service)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	err = svc.OnStartup(ctx)
	require.NoError(t, err)

	// Verify both sockets appeared
	require.Eventually(t, func() bool {
		_, err := os.Stat(sockPath)
		return err == nil
	}, 10*time.Second, 50*time.Millisecond, "core socket should appear")

	require.Eventually(t, func() bool {
		_, err := os.Stat(denoSockPath)
		return err == nil
	}, 10*time.Second, 50*time.Millisecond, "deno socket should appear")

	// Verify sidecar is running
	assert.True(t, svc.sidecar.IsRunning(), "Deno sidecar should be running")

	// Verify DenoClient is connected
	require.NotNil(t, svc.DenoClient(), "DenoClient should be connected")

	// Test Go → Deno: LoadModule with real Worker
	modPath := testModulePath(t)
	loadResp, err := svc.DenoClient().LoadModule("test-module", modPath, ModulePermissions{
		Read: []string{filepath.Dir(modPath) + "/"},
	})
	require.NoError(t, err)
	assert.True(t, loadResp.Ok)

	// Wait for module to finish loading (async Worker init)
	require.Eventually(t, func() bool {
		resp, err := svc.DenoClient().ModuleStatus("test-module")
		return err == nil && (resp.Status == "RUNNING" || resp.Status == "ERRORED")
	}, 5*time.Second, 50*time.Millisecond, "module should finish loading")

	statusResp, err := svc.DenoClient().ModuleStatus("test-module")
	require.NoError(t, err)
	assert.Equal(t, "test-module", statusResp.Code)
	assert.Equal(t, "RUNNING", statusResp.Status)

	// Test Go → Deno: UnloadModule
	unloadResp, err := svc.DenoClient().UnloadModule("test-module")
	require.NoError(t, err)
	assert.True(t, unloadResp.Ok)

	// Verify module is now STOPPED
	statusResp2, err := svc.DenoClient().ModuleStatus("test-module")
	require.NoError(t, err)
	assert.Equal(t, "STOPPED", statusResp2.Status)

	// Verify CoreService gRPC still works (Deno wrote health check data)
	conn, err := grpc.NewClient(
		"unix://"+sockPath,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	require.NoError(t, err)
	defer conn.Close()

	coreClient := pb.NewCoreServiceClient(conn)
	getResp, err := coreClient.StoreGet(ctx, &pb.StoreGetRequest{
		Group: "_coredeno", Key: "status",
	})
	require.NoError(t, err)
	assert.True(t, getResp.Found)
	assert.Equal(t, "connected", getResp.Value, "Deno should have written health check")

	// Clean shutdown
	err = svc.OnShutdown(context.Background())
	assert.NoError(t, err)
	assert.False(t, svc.sidecar.IsRunning(), "Deno sidecar should be stopped")
}

func TestIntegration_Tier3_WorkerIsolation_Good(t *testing.T) {
	denoPath := findDeno(t)

	tmpDir := t.TempDir()
	sockPath := filepath.Join(tmpDir, "core.sock")
	denoSockPath := filepath.Join(tmpDir, "deno.sock")

	// Write a manifest
	coreDir := filepath.Join(tmpDir, ".core")
	require.NoError(t, os.MkdirAll(coreDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(coreDir, "view.yml"), []byte(`
code: tier3-test
name: Tier 3 Test
version: "1.0"
permissions:
  read: ["./data/"]
`), 0644))

	entryPoint := runtimeEntryPoint(t)
	modPath := testModulePath(t)

	opts := Options{
		DenoPath:       denoPath,
		SocketPath:     sockPath,
		DenoSocketPath: denoSockPath,
		AppRoot:        tmpDir,
		StoreDBPath:    ":memory:",
		SidecarArgs:    []string{"run", "-A", "--unstable-worker-options", entryPoint},
	}

	c, err := core.New()
	require.NoError(t, err)

	factory := NewServiceFactory(opts)
	result, err := factory(c)
	require.NoError(t, err)
	svc := result.(*Service)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	err = svc.OnStartup(ctx)
	require.NoError(t, err)

	// Verify both sockets appeared
	require.Eventually(t, func() bool {
		_, err := os.Stat(denoSockPath)
		return err == nil
	}, 10*time.Second, 50*time.Millisecond, "deno socket should appear")

	require.NotNil(t, svc.DenoClient(), "DenoClient should be connected")

	// Load a real module — it writes to store via I/O bridge
	loadResp, err := svc.DenoClient().LoadModule("test-mod", modPath, ModulePermissions{
		Read: []string{filepath.Dir(modPath) + "/"},
	})
	require.NoError(t, err)
	assert.True(t, loadResp.Ok)

	// Wait for module to reach RUNNING (Worker init + init() completes)
	require.Eventually(t, func() bool {
		resp, err := svc.DenoClient().ModuleStatus("test-mod")
		return err == nil && resp.Status == "RUNNING"
	}, 10*time.Second, 100*time.Millisecond, "module should be RUNNING")

	// Verify the module wrote to the store via the I/O bridge
	// Module calls: core.storeSet("test-module", "init", "ok")
	conn, err := grpc.NewClient(
		"unix://"+sockPath,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	require.NoError(t, err)
	defer conn.Close()

	coreClient := pb.NewCoreServiceClient(conn)

	// Poll for the store value — module init is async
	require.Eventually(t, func() bool {
		resp, err := coreClient.StoreGet(ctx, &pb.StoreGetRequest{
			Group: "test-module", Key: "init",
		})
		return err == nil && resp.Found && resp.Value == "ok"
	}, 5*time.Second, 100*time.Millisecond, "module should have written to store via I/O bridge")

	// Unload and verify
	unloadResp, err := svc.DenoClient().UnloadModule("test-mod")
	require.NoError(t, err)
	assert.True(t, unloadResp.Ok)

	statusResp, err := svc.DenoClient().ModuleStatus("test-mod")
	require.NoError(t, err)
	assert.Equal(t, "STOPPED", statusResp.Status)

	// Clean shutdown
	err = svc.OnShutdown(context.Background())
	assert.NoError(t, err)
	assert.False(t, svc.sidecar.IsRunning(), "Deno sidecar should be stopped")
}

// createModuleRepo creates a git repo containing a test module with manifest + main.ts.
// The module's init() writes to the store to prove the I/O bridge works.
func createModuleRepo(t *testing.T, code string) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), code+"-repo")
	require.NoError(t, os.MkdirAll(filepath.Join(dir, ".core"), 0755))

	require.NoError(t, os.WriteFile(filepath.Join(dir, ".core", "view.yml"), []byte(`
code: `+code+`
name: Test Module `+code+`
version: "1.0"
permissions:
  read: ["./"]
`), 0644))

	// Module that writes to store to prove it ran
	require.NoError(t, os.WriteFile(filepath.Join(dir, "main.ts"), []byte(`
export async function init(core: any) {
  await core.storeSet("`+code+`", "installed", "yes");
}
`), 0644))

	gitCmd := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{
			"-C", dir, "-c", "user.email=test@test.com", "-c", "user.name=test",
		}, args...)...)
		out, err := cmd.CombinedOutput()
		require.NoError(t, err, "git %v: %s", args, string(out))
	}
	gitCmd("init")
	gitCmd("add", ".")
	gitCmd("commit", "-m", "init")

	return dir
}

func TestIntegration_Tier4_MarketplaceInstall_Good(t *testing.T) {
	denoPath := findDeno(t)

	tmpDir := t.TempDir()
	sockPath := filepath.Join(tmpDir, "core.sock")
	denoSockPath := filepath.Join(tmpDir, "deno.sock")

	// Write app manifest
	coreDir := filepath.Join(tmpDir, ".core")
	require.NoError(t, os.MkdirAll(coreDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(coreDir, "view.yml"), []byte(`
code: tier4-test
name: Tier 4 Test
version: "1.0"
permissions:
  read: ["./"]
`), 0644))

	entryPoint := runtimeEntryPoint(t)

	opts := Options{
		DenoPath:       denoPath,
		SocketPath:     sockPath,
		DenoSocketPath: denoSockPath,
		AppRoot:        tmpDir,
		StoreDBPath:    ":memory:",
		SidecarArgs:    []string{"run", "-A", "--unstable-worker-options", entryPoint},
	}

	c, err := core.New()
	require.NoError(t, err)

	factory := NewServiceFactory(opts)
	result, err := factory(c)
	require.NoError(t, err)
	svc := result.(*Service)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	err = svc.OnStartup(ctx)
	require.NoError(t, err)

	// Verify sidecar and Deno client are up
	require.Eventually(t, func() bool {
		_, err := os.Stat(denoSockPath)
		return err == nil
	}, 10*time.Second, 50*time.Millisecond, "deno socket should appear")

	require.NotNil(t, svc.DenoClient(), "DenoClient should be connected")
	require.NotNil(t, svc.Installer(), "Installer should be available")

	// Create a test module repo and install it
	moduleRepo := createModuleRepo(t, "market-mod")
	err = svc.Installer().Install(ctx, marketplace.Module{
		Code: "market-mod",
		Repo: moduleRepo,
	})
	require.NoError(t, err)

	// Verify the module was installed on disk
	modulesDir := filepath.Join(tmpDir, "modules", "market-mod")
	require.DirExists(t, modulesDir)

	// Verify Installed() returns it
	installed, err := svc.Installer().Installed()
	require.NoError(t, err)
	require.Len(t, installed, 1)
	assert.Equal(t, "market-mod", installed[0].Code)
	assert.Equal(t, "1.0", installed[0].Version)

	// Load the installed module into the Deno runtime
	mod := installed[0]
	loadResp, err := svc.DenoClient().LoadModule(mod.Code, mod.EntryPoint, ModulePermissions{
		Read: mod.Permissions.Read,
	})
	require.NoError(t, err)
	assert.True(t, loadResp.Ok)

	// Wait for module to reach RUNNING
	require.Eventually(t, func() bool {
		resp, err := svc.DenoClient().ModuleStatus("market-mod")
		return err == nil && resp.Status == "RUNNING"
	}, 10*time.Second, 100*time.Millisecond, "installed module should be RUNNING")

	// Verify the module wrote to the store via I/O bridge
	conn, err := grpc.NewClient(
		"unix://"+sockPath,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	require.NoError(t, err)
	defer conn.Close()

	coreClient := pb.NewCoreServiceClient(conn)
	require.Eventually(t, func() bool {
		resp, err := coreClient.StoreGet(ctx, &pb.StoreGetRequest{
			Group: "market-mod", Key: "installed",
		})
		return err == nil && resp.Found && resp.Value == "yes"
	}, 5*time.Second, 100*time.Millisecond, "installed module should have written to store via I/O bridge")

	// Unload and remove
	unloadResp, err := svc.DenoClient().UnloadModule("market-mod")
	require.NoError(t, err)
	assert.True(t, unloadResp.Ok)

	err = svc.Installer().Remove("market-mod")
	require.NoError(t, err)
	assert.NoDirExists(t, modulesDir, "module directory should be removed")

	installed2, err := svc.Installer().Installed()
	require.NoError(t, err)
	assert.Empty(t, installed2, "no modules should be installed after remove")

	// Clean shutdown
	err = svc.OnShutdown(context.Background())
	assert.NoError(t, err)
	assert.False(t, svc.sidecar.IsRunning(), "Deno sidecar should be stopped")
}
