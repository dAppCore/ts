package ts

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewSidecar_Good(t *testing.T) {
	opts := Options{
		DenoPath:   "echo",
		SocketPath: "/tmp/test-core-deno.sock",
	}
	sc := NewSidecar(opts)
	require.NotNil(t, sc)
	assert.Equal(t, "echo", sc.opts.DenoPath)
	assert.Equal(t, "/tmp/test-core-deno.sock", sc.opts.SocketPath)
}

func TestDefaultSocketPath_Good(t *testing.T) {
	path := DefaultSocketPath()
	assert.Contains(t, path, "core/core.sock")
}

func TestSidecar_PermissionFlags_Good(t *testing.T) {
	perms := Permissions{
		Read:  []string{"./data/"},
		Write: []string{"./data/config.json"},
		Net:   []string{"pool.lthn.io:3333"},
		Run:   []string{"xmrig"},
	}
	flags := perms.Flags()
	assert.Contains(t, flags, "--allow-read=./data/")
	assert.Contains(t, flags, "--allow-write=./data/config.json")
	assert.Contains(t, flags, "--allow-net=pool.lthn.io:3333")
	assert.Contains(t, flags, "--allow-run=xmrig")
}

func TestSidecar_PermissionFlags_Empty(t *testing.T) {
	perms := Permissions{}
	flags := perms.Flags()
	assert.Equal(t, []string{"--deny-read", "--deny-write", "--deny-net", "--deny-run"}, flags)
}

func TestOptions_AppRoot_Good(t *testing.T) {
	opts := Options{
		DenoPath:    "deno",
		SocketPath:  "/tmp/test.sock",
		AppRoot:     "/app",
		StoreDBPath: "/app/.core/store.db",
	}
	sc := NewSidecar(opts)
	assert.Equal(t, "/app", sc.opts.AppRoot)
	assert.Equal(t, "/app/.core/store.db", sc.opts.StoreDBPath)
}

func TestOptions_StoreDBPath_Default_Good(t *testing.T) {
	opts := Options{AppRoot: "/app"}
	sc := NewSidecar(opts)
	assert.Equal(t, "/app/.core/store.db", sc.opts.StoreDBPath,
		"StoreDBPath should default to AppRoot/.core/store.db")
}

func TestOptions_SidecarArgs_Good(t *testing.T) {
	opts := Options{
		DenoPath:    "deno",
		SidecarArgs: []string{"run", "--allow-env", "main.ts"},
	}
	sc := NewSidecar(opts)
	assert.Equal(t, []string{"run", "--allow-env", "main.ts"}, sc.opts.SidecarArgs)
}

func TestDefaultSocketPath_XDG(t *testing.T) {
	orig := os.Getenv("XDG_RUNTIME_DIR")
	defer os.Setenv("XDG_RUNTIME_DIR", orig)

	os.Setenv("XDG_RUNTIME_DIR", "/run/user/1000")
	path := DefaultSocketPath()
	assert.Equal(t, "/run/user/1000/core/core.sock", path)
}

func TestOptions_DenoSocketPath_Default_Good(t *testing.T) {
	opts := Options{SocketPath: "/tmp/core/core.sock"}
	sc := NewSidecar(opts)
	assert.Equal(t, "/tmp/core/deno.sock", sc.opts.DenoSocketPath,
		"DenoSocketPath should default to same dir as SocketPath with deno.sock")
}

func TestOptions_DenoSocketPath_Explicit_Good(t *testing.T) {
	opts := Options{
		SocketPath:     "/tmp/core/core.sock",
		DenoSocketPath: "/tmp/custom/deno.sock",
	}
	sc := NewSidecar(opts)
	assert.Equal(t, "/tmp/custom/deno.sock", sc.opts.DenoSocketPath,
		"Explicit DenoSocketPath should not be overridden")
}

func TestOptions_DefaultSocketPaths_Good(t *testing.T) {
	orig := os.Getenv("XDG_RUNTIME_DIR")
	defer os.Setenv("XDG_RUNTIME_DIR", orig)

	tmpDir := t.TempDir()
	os.Setenv("XDG_RUNTIME_DIR", tmpDir)

	sc := NewSidecar(Options{})
	assert.Equal(t, filepath.Join(tmpDir, "core", "core.sock"), sc.opts.SocketPath)
	assert.Equal(t, filepath.Join(tmpDir, "core", "deno.sock"), sc.opts.DenoSocketPath)
}
