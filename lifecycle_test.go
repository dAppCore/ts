package ts

import (
	"context"
	"os"
	"path/filepath"
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

func TestStart_Good_DenoSocketEnv(t *testing.T) {
	sockDir := t.TempDir()
	sockPath := filepath.Join(sockDir, "core.sock")
	denoSockPath := filepath.Join(sockDir, "deno.sock")

	sc := NewSidecar(Options{
		DenoPath:       "sleep",
		SocketPath:     sockPath,
		DenoSocketPath: denoSockPath,
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
	for _, e := range env {
		if e == "CORE_SOCKET="+sockPath {
			foundCore = true
		}
		if e == "DENO_SOCKET="+denoSockPath {
			foundDeno = true
		}
	}
	assert.True(t, foundCore, "child should receive CORE_SOCKET")
	assert.True(t, foundDeno, "child should receive DENO_SOCKET")
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
