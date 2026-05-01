package ts

import (
	"context"
	"crypto/ed25519"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// Options configures the CoreDeno sidecar.
type Options struct {
	DenoPath       string            // path to deno binary (default: "deno")
	SocketPath     string            // Unix socket path for Go's gRPC server (CoreService)
	DenoSocketPath string            // Unix socket path for Deno's gRPC server (DenoService)
	AppRoot        string            // app root directory (sandboxed I/O)
	StoreDBPath    string            // SQLite DB path (default: AppRoot/.core/store.db)
	PublicKey      ed25519.PublicKey // ed25519 public key for manifest verification (optional)
	SidecarArgs    []string          // args passed to the sidecar process
	DevRoot        string            // root directory watched by the optional dev server
	HMRPath        string            // HTTP path exposed for hot reload notifications
}

// Permissions declares per-module Deno permission flags.
type Permissions struct {
	Read  []string
	Write []string
	Net   []string
	Run   []string
}

// Flags converts permissions to Deno --allow-* CLI flags.
func (p Permissions) Flags() []string {
	var flags []string
	if len(p.Read) > 0 {
		flags = append(flags, fmt.Sprintf("--allow-read=%s", strings.Join(p.Read, ",")))
	} else {
		flags = append(flags, "--deny-read")
	}
	if len(p.Write) > 0 {
		flags = append(flags, fmt.Sprintf("--allow-write=%s", strings.Join(p.Write, ",")))
	} else {
		flags = append(flags, "--deny-write")
	}
	if len(p.Net) > 0 {
		flags = append(flags, fmt.Sprintf("--allow-net=%s", strings.Join(p.Net, ",")))
	} else {
		flags = append(flags, "--deny-net")
	}
	if len(p.Run) > 0 {
		flags = append(flags, fmt.Sprintf("--allow-run=%s", strings.Join(p.Run, ",")))
	} else {
		flags = append(flags, "--deny-run")
	}
	return flags
}

// DefaultSocketPath returns the default Unix socket path for CoreService.
func DefaultSocketPath() string {
	if runtime.GOOS == "darwin" {
		return filepath.Join("/tmp", "core", "core.sock")
	}

	xdg := os.Getenv("XDG_RUNTIME_DIR")
	if xdg == "" {
		xdg = "/tmp"
	}
	return filepath.Join(xdg, "core", "core.sock")
}

// Sidecar manages a Deno child process.
type Sidecar struct {
	opts    Options
	mu      sync.RWMutex
	cmd     *exec.Cmd
	ctx     context.Context
	cancel  context.CancelFunc
	done    chan struct{}
	exitErr error
}

// NewSidecar creates a Sidecar with the given options.
func NewSidecar(opts Options) *Sidecar {
	if opts.DenoPath == "" {
		opts.DenoPath = "deno"
	}
	if opts.SocketPath == "" {
		opts.SocketPath = DefaultSocketPath()
	}
	if opts.DenoSocketPath == "" && opts.SocketPath != "" {
		opts.DenoSocketPath = filepath.Join(filepath.Dir(opts.SocketPath), "deno.sock")
	}
	if opts.StoreDBPath == "" && opts.AppRoot != "" {
		opts.StoreDBPath = filepath.Join(opts.AppRoot, ".core", "store.db")
	}
	return &Sidecar{opts: opts}
}
