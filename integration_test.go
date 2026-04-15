//go:build integration

package ts

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	core "dappco.re/go/core"
	"dappco.re/go/core/scm/marketplace"
	pb "dappco.re/go/core/ts/proto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

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
	// runtime/ is a subdir of the package root
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

// fileOpsModulePath returns the absolute path to runtime/testdata/file-ops-module.ts.
func fileOpsModulePath(t *testing.T) string {
	t.Helper()
	abs, err := filepath.Abs("runtime/testdata/file-ops-module.ts")
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

	c := core.New()

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

	c := core.New()

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
	loadResp, err := svc.LoadModule("test-module", modPath, ModulePermissions{
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

	// Verify CoreService health ping works end to end.
	conn, err := grpc.NewClient(
		"unix://"+sockPath,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	require.NoError(t, err)
	defer conn.Close()

	coreClient := pb.NewCoreServiceClient(conn)
	pingResp, err := coreClient.Ping(ctx, &pb.PingRequest{})
	require.NoError(t, err)
	assert.True(t, pingResp.Ok)

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

	c := core.New()

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
	loadResp, err := svc.LoadModule("test-mod", modPath, ModulePermissions{
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

func TestIntegration_Tier3_FileBridge_Good(t *testing.T) {
	denoPath := findDeno(t)

	tmpDir := t.TempDir()
	sockPath := filepath.Join(tmpDir, "core.sock")
	denoSockPath := filepath.Join(tmpDir, "deno.sock")
	dataDir := filepath.Join(tmpDir, "sandbox")

	require.NoError(t, os.MkdirAll(dataDir, 0755))

	coreDir := filepath.Join(tmpDir, ".core")
	require.NoError(t, os.MkdirAll(coreDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(coreDir, "view.yml"), []byte(`
code: tier3-file-test
name: Tier 3 File Bridge Test
version: "1.0"
permissions:
  read: ["./sandbox/"]
  write: ["./sandbox/"]
`), 0644))

	entryPoint := runtimeEntryPoint(t)
	modPath := fileOpsModulePath(t)

	opts := Options{
		DenoPath:       denoPath,
		SocketPath:     sockPath,
		DenoSocketPath: denoSockPath,
		AppRoot:        tmpDir,
		StoreDBPath:    ":memory:",
		SidecarArgs:    []string{"run", "-A", "--unstable-worker-options", entryPoint},
	}

	c := core.New()

	factory := NewServiceFactory(opts)
	result, err := factory(c)
	require.NoError(t, err)
	svc := result.(*Service)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	err = svc.OnStartup(ctx)
	require.NoError(t, err)

	require.Eventually(t, func() bool {
		_, err := os.Stat(denoSockPath)
		return err == nil
	}, 10*time.Second, 50*time.Millisecond, "deno socket should appear")

	loadResp, err := svc.LoadModule("file-mod", modPath, ModulePermissions{
		Read:  []string{"./sandbox/"},
		Write: []string{"./sandbox/"},
	})
	require.NoError(t, err)
	assert.True(t, loadResp.Ok)

	require.Eventually(t, func() bool {
		resp, err := svc.ModuleStatus("file-mod")
		return err == nil && resp.Status == "RUNNING"
	}, 10*time.Second, 100*time.Millisecond, "module should be RUNNING")

	conn, err := grpc.NewClient(
		"unix://"+sockPath,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	require.NoError(t, err)
	defer conn.Close()

	coreClient := pb.NewCoreServiceClient(conn)
	require.Eventually(t, func() bool {
		listing, listErr := coreClient.StoreGet(ctx, &pb.StoreGetRequest{
			Group: "file-mod", Key: "listing",
		})
		content, contentErr := coreClient.StoreGet(ctx, &pb.StoreGetRequest{
			Group: "file-mod", Key: "content",
		})
		deleted, deletedErr := coreClient.StoreGet(ctx, &pb.StoreGetRequest{
			Group: "file-mod", Key: "deleted",
		})
		return listErr == nil && contentErr == nil && deletedErr == nil &&
			listing.Found && content.Found && deleted.Found &&
			listing.Value == "demo.txt" &&
			content.Value == "hello from module" &&
			deleted.Value == "yes"
	}, 5*time.Second, 100*time.Millisecond, "module should complete file bridge operations")

	_, err = os.Stat(filepath.Join(dataDir, "demo.txt"))
	require.Error(t, err)
	assert.True(t, os.IsNotExist(err), "module should delete its sandbox file")

	unloadResp, err := svc.UnloadModule("file-mod")
	require.NoError(t, err)
	assert.True(t, unloadResp.Ok)

	err = svc.OnShutdown(context.Background())
	assert.NoError(t, err)
}

func TestIntegration_Tier3_SidecarRestart_Good(t *testing.T) {
	denoPath := findDeno(t)

	tmpDir := t.TempDir()
	sockPath := filepath.Join(tmpDir, "core.sock")
	denoSockPath := filepath.Join(tmpDir, "deno.sock")

	coreDir := filepath.Join(tmpDir, ".core")
	require.NoError(t, os.MkdirAll(coreDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(coreDir, "view.yml"), []byte(`
code: tier3-restart-test
name: Tier 3 Restart Test
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

	c := core.New()

	factory := NewServiceFactory(opts)
	result, err := factory(c)
	require.NoError(t, err)
	svc := result.(*Service)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	err = svc.OnStartup(ctx)
	require.NoError(t, err)

	loadResp, err := svc.LoadModule("restart-mod", modPath, ModulePermissions{
		Read: []string{filepath.Dir(modPath) + "/"},
	})
	require.NoError(t, err)
	require.True(t, loadResp.Ok)

	require.Eventually(t, func() bool {
		resp, err := svc.ModuleStatus("restart-mod")
		return err == nil && resp.Status == "RUNNING"
	}, 10*time.Second, 100*time.Millisecond, "module should be RUNNING before restart")

	svc.sidecar.mu.RLock()
	require.NotNil(t, svc.sidecar.cmd)
	require.NotNil(t, svc.sidecar.cmd.Process)
	initialPID := svc.sidecar.cmd.Process.Pid
	process := svc.sidecar.cmd.Process
	svc.sidecar.mu.RUnlock()

	require.NoError(t, process.Kill())

	require.Eventually(t, func() bool {
		svc.sidecar.mu.RLock()
		cmd := svc.sidecar.cmd
		restartedPID := 0
		if cmd != nil && cmd.Process != nil {
			restartedPID = cmd.Process.Pid
		}
		svc.sidecar.mu.RUnlock()

		if restartedPID == 0 || restartedPID == initialPID {
			return false
		}

		client := svc.DenoClient()
		if client == nil || client.Ping() != nil {
			return false
		}

		resp, err := svc.ModuleStatus("restart-mod")
		return err == nil && resp.Status == "RUNNING"
	}, 15*time.Second, 200*time.Millisecond, "sidecar should restart and reload modules")

	err = svc.OnShutdown(context.Background())
	require.NoError(t, err)
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

	c := core.New()

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
	loadResp, err := svc.LoadModule(mod.Code, mod.EntryPoint, ModulePermissions{
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
