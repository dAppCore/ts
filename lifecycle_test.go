package ts

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStart_Good(t *testing.T) {
	sockDir := t.TempDir()
	sc := NewSidecar(Options{
		DenoPath:   "sleep",
		SocketPath: filepath.Join(sockDir, "test.sock"),
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	err := sc.Start(ctx, "10") // sleep 10 — will be killed by Stop
	require.NoError(t, err)
	assert.True(t, sc.IsRunning())

	err = sc.Stop()
	require.NoError(t, err)
	assert.False(t, sc.IsRunning())
}

func TestStart_Bad_AlreadyRunning(t *testing.T) {
	sockDir := t.TempDir()
	sc := NewSidecar(Options{
		DenoPath:   "sleep",
		SocketPath: filepath.Join(sockDir, "test.sock"),
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	require.NoError(t, sc.Start(ctx, "10"))
	defer sc.Stop()

	err := sc.Start(ctx, "10")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "already running")
}

func TestStop_Good_NotStarted(t *testing.T) {
	sc := NewSidecar(Options{DenoPath: "sleep"})
	err := sc.Stop()
	assert.NoError(t, err, "stopping a not-started sidecar should be a no-op")
}

func TestStart_Good_EnvPassedToChild(t *testing.T) {
	sockDir := t.TempDir()
	sockPath := filepath.Join(sockDir, "test.sock")

	sc := NewSidecar(Options{
		DenoPath:   "sleep",
		SocketPath: sockPath,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	err := sc.Start(ctx, "10")
	require.NoError(t, err)
	defer sc.Stop()

	// Verify the child process has CORE_SOCKET in its environment
	sc.mu.RLock()
	env := sc.cmd.Env
	sc.mu.RUnlock()

	found := false
	expected := "CORE_SOCKET=" + sockPath
	for _, e := range env {
		if e == expected {
			found = true
			break
		}
	}
	assert.True(t, found, "child process should receive CORE_SOCKET=%s", sockPath)
}

func TestExitError_Good_RecordedAfterUnexpectedExit(t *testing.T) {
	sockDir := t.TempDir()
	sc := NewSidecar(Options{
		DenoPath:   "sh",
		SocketPath: filepath.Join(sockDir, "test.sock"),
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	require.NoError(t, sc.Start(ctx, "-c", "exit 7"))

	require.Eventually(t, func() bool {
		return !sc.IsRunning()
	}, 2*time.Second, 10*time.Millisecond, "sidecar should record the child exit")

	require.Error(t, sc.ExitError())
	assert.Contains(t, sc.ExitError().Error(), "exit status 7")
}

func TestStart_Good_AppRootSetsWorkingDirectory(t *testing.T) {
	baseDir := t.TempDir()
	appRoot := filepath.Join(baseDir, "app")
	require.NoError(t, os.MkdirAll(appRoot, 0755))

	outPath := filepath.Join(baseDir, "cwd.txt")
	sc := NewSidecar(Options{
		DenoPath:   "sh",
		SocketPath: filepath.Join(baseDir, "core.sock"),
		AppRoot:    appRoot,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	err := sc.Start(ctx, "-c", "pwd > "+outPath+"; sleep 10")
	require.NoError(t, err)
	defer sc.Stop()

	require.Eventually(t, func() bool {
		data, err := os.ReadFile(outPath)
		if err != nil {
			return false
		}
		return strings.TrimSpace(string(data)) == appRoot
	}, 2*time.Second, 10*time.Millisecond, "child should run with AppRoot as its working directory")
}

func TestStart_Good_DenoSocketEnv(t *testing.T) {
	sockDir := t.TempDir()
	sockPath := filepath.Join(sockDir, "core.sock")
	denoSockPath := filepath.Join(sockDir, "deno.sock")
	devRoot := filepath.Join(sockDir, "dev")
	hmrPath := "/_core/hmr"

	sc := NewSidecar(Options{
		DenoPath:       "sleep",
		SocketPath:     sockPath,
		DenoSocketPath: denoSockPath,
		DevRoot:        devRoot,
		HMRPath:        hmrPath,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	err := sc.Start(ctx, "10")
	require.NoError(t, err)
	defer sc.Stop()

	sc.mu.RLock()
	env := sc.cmd.Env
	sc.mu.RUnlock()

	foundCore := false
	foundDeno := false
	foundDevRoot := false
	foundHMRPath := false
	for _, e := range env {
		if e == "CORE_SOCKET="+sockPath {
			foundCore = true
		}
		if e == "DENO_SOCKET="+denoSockPath {
			foundDeno = true
		}
		if e == "CORE_DEV_ROOT="+devRoot {
			foundDevRoot = true
		}
		if e == "CORE_HMR_PATH="+hmrPath {
			foundHMRPath = true
		}
	}
	assert.True(t, foundCore, "child should receive CORE_SOCKET")
	assert.True(t, foundDeno, "child should receive DENO_SOCKET")
	assert.True(t, foundDevRoot, "child should receive CORE_DEV_ROOT")
	assert.True(t, foundHMRPath, "child should receive CORE_HMR_PATH")
}

func TestSocketDirCreated_Good(t *testing.T) {
	dir := t.TempDir()
	sockPath := filepath.Join(dir, "sub", "deno.sock")
	sc := NewSidecar(Options{
		DenoPath:   "sleep",
		SocketPath: sockPath,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	err := sc.Start(ctx, "10")
	require.NoError(t, err)
	defer sc.Stop()

	_, err = os.Stat(filepath.Join(dir, "sub"))
	assert.NoError(t, err, "socket directory should be created")
}
