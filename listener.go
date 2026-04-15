package ts

import (
	"context"
	"fmt"
	"net"
	"os"

	pb "dappco.re/go/core/ts/proto"
	"google.golang.org/grpc"
)

// ListenGRPC starts a gRPC server on a Unix socket, serving the CoreService.
// It blocks until ctx is cancelled, then performs a graceful stop.
func ListenGRPC(ctx context.Context, socketPath string, srv *Server) error {
	// Clean up stale socket
	if err := os.Remove(socketPath); err != nil && !os.IsNotExist(err) {
		return err
	}

	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return err
	}
	// Restrict socket to owner only — prevents other users from sending gRPC commands.
	if err := os.Chmod(socketPath, 0600); err != nil {
		listener.Close()
		return fmt.Errorf("chmod socket: %w", err)
	}
	defer func() {
		_ = listener.Close()
		_ = os.Remove(socketPath)
	}()

	gs := grpc.NewServer()
	pb.RegisterCoreServiceServer(gs, srv)

	// Graceful stop when context cancelled
	go func() {
		<-ctx.Done()
		gs.GracefulStop()
	}()

	if err := gs.Serve(listener); err != nil {
		select {
		case <-ctx.Done():
			return nil // Expected shutdown
		default:
			return err
		}
	}
	return nil
}
