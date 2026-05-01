package ts

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"
	"time"
)

// Start launches the Deno sidecar process with the given entrypoint args.
func (s *Sidecar) Start(ctx context.Context, args ...string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.cmd != nil {
		return errors.New("coredeno: already running")
	}

	// Ensure socket directory exists with owner-only permissions
	sockDir := filepath.Dir(s.opts.SocketPath)
	if err := ensureSecureSocketDir(sockDir); err != nil {
		return fmt.Errorf("coredeno: socket dir: %w", err)
	}
	if err := os.MkdirAll(sockDir, 0700); err != nil {
		return fmt.Errorf("coredeno: mkdir %s: %w", sockDir, err)
	}
	if err := os.Chmod(sockDir, 0700); err != nil {
		return fmt.Errorf("coredeno: chmod socket dir: %w", err)
	}

	if s.opts.DenoSocketPath != "" {
		denoSockDir := filepath.Dir(s.opts.DenoSocketPath)
		if denoSockDir != "" && denoSockDir != "." {
			if err := ensureSecureSocketDir(denoSockDir); err != nil {
				return fmt.Errorf("coredeno: socket dir: %w", err)
			}
			if err := os.MkdirAll(denoSockDir, 0700); err != nil {
				return fmt.Errorf("coredeno: mkdir %s: %w", denoSockDir, err)
			}
			if err := os.Chmod(denoSockDir, 0700); err != nil {
				return fmt.Errorf("coredeno: chmod socket dir: %w", err)
			}
		}
	}

	// Remove stale Deno socket (the Core socket is managed by ListenGRPC)
	if s.opts.DenoSocketPath != "" {
		os.Remove(s.opts.DenoSocketPath)
	}

	s.ctx, s.cancel = context.WithCancel(ctx)
	s.cmd = exec.Command(s.opts.DenoPath, args...)
	if s.opts.AppRoot != "" {
		s.cmd.Dir = s.opts.AppRoot
	}
	s.cmd.Env = append(os.Environ(),
		"CORE_SOCKET="+s.opts.SocketPath,
		"DENO_SOCKET="+s.opts.DenoSocketPath,
	)
	if s.opts.AppRoot != "" {
		s.cmd.Env = append(s.cmd.Env, "PWD="+s.opts.AppRoot)
	}
	if s.opts.DevRoot != "" {
		s.cmd.Env = append(s.cmd.Env, "CORE_DEV_ROOT="+s.opts.DevRoot)
	}
	if s.opts.HMRPath != "" {
		s.cmd.Env = append(s.cmd.Env, "CORE_HMR_PATH="+s.opts.HMRPath)
	}
	s.done = make(chan struct{})
	s.exitErr = nil
	if err := s.cmd.Start(); err != nil {
		s.cmd = nil
		s.cancel()
		return fmt.Errorf("coredeno: start: %w", err)
	}

	// Monitor in background — waits for exit, then signals done
	cmd := s.cmd
	done := s.done
	go func() {
		err := cmd.Wait()
		s.mu.Lock()
		if s.cmd == cmd {
			s.cmd = nil
			s.exitErr = err
		}
		s.mu.Unlock()
		close(done)
	}()
	go func() {
		<-s.ctx.Done()
		s.terminate(cmd, done)
	}()
	return nil
}

// Stop cancels the context and waits for the process to exit.
func (s *Sidecar) Stop() error {
	s.mu.RLock()
	if s.cmd == nil {
		s.mu.RUnlock()
		return nil
	}
	cmd := s.cmd
	done := s.done
	s.mu.RUnlock()

	s.cancel()
	s.terminate(cmd, done)
	<-done
	return nil
}

// IsRunning returns true if the sidecar process is alive.
func (s *Sidecar) IsRunning() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cmd != nil
}

// ExitError returns the most recent process exit error, if any.
func (s *Sidecar) ExitError() error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.exitErr
}

func (s *Sidecar) terminate(cmd *exec.Cmd, done <-chan struct{}) {
	if cmd == nil || cmd.Process == nil {
		return
	}

	if runtime.GOOS == "windows" {
		_ = cmd.Process.Kill()
		return
	}

	_ = cmd.Process.Signal(syscall.SIGTERM)

	select {
	case <-done:
		return
	case <-time.After(5 * time.Second):
		_ = cmd.Process.Kill()
	}
}
