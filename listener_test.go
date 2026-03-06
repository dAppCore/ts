package ts

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	pb "forge.lthn.ai/core/ts/proto"
	"forge.lthn.ai/core/go/pkg/io"
	"forge.lthn.ai/core/go/pkg/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

func TestListenGRPC_Good(t *testing.T) {
	sockDir := t.TempDir()
	sockPath := filepath.Join(sockDir, "test.sock")

	medium := io.NewMockMedium()
	st, err := store.New(":memory:")
	require.NoError(t, err)
	defer st.Close()

	srv := NewServer(medium, st)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- ListenGRPC(ctx, sockPath, srv)
	}()

	// Wait for socket to appear
	require.Eventually(t, func() bool {
		_, err := os.Stat(sockPath)
		return err == nil
	}, 2*time.Second, 10*time.Millisecond, "socket should appear")

	// Connect as gRPC client
	conn, err := grpc.NewClient(
		"unix://"+sockPath,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	require.NoError(t, err)
	defer conn.Close()

	client := pb.NewCoreServiceClient(conn)

	// StoreSet + StoreGet round-trip
	_, err = client.StoreSet(ctx, &pb.StoreSetRequest{
		Group: "test", Key: "k", Value: "v",
	})
	require.NoError(t, err)

	resp, err := client.StoreGet(ctx, &pb.StoreGetRequest{
		Group: "test", Key: "k",
	})
	require.NoError(t, err)
	assert.True(t, resp.Found)
	assert.Equal(t, "v", resp.Value)

	// Cancel ctx to stop listener
	cancel()

	select {
	case err := <-errCh:
		assert.NoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("listener did not stop")
	}
}

func TestListenGRPC_Bad_StaleSocket(t *testing.T) {
	// Use a short temp dir — macOS limits Unix socket paths to 104 bytes (sun_path)
	// and t.TempDir() + this test's long name can exceed that.
	sockDir, err := os.MkdirTemp("", "grpc")
	require.NoError(t, err)
	t.Cleanup(func() { os.RemoveAll(sockDir) })
	sockPath := filepath.Join(sockDir, "s.sock")

	// Create a stale regular file where the socket should go
	require.NoError(t, os.WriteFile(sockPath, []byte("stale"), 0644))

	medium := io.NewMockMedium()
	st, err := store.New(":memory:")
	require.NoError(t, err)
	defer st.Close()

	srv := NewServer(medium, st)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- ListenGRPC(ctx, sockPath, srv)
	}()

	// Should replace stale file and start listening.
	// Also watch errCh — if ListenGRPC returns early, fail with the actual error.
	require.Eventually(t, func() bool {
		select {
		case err := <-errCh:
			t.Fatalf("ListenGRPC returned early: %v", err)
			return false
		default:
		}
		info, err := os.Stat(sockPath)
		if err != nil {
			return false
		}
		return info.Mode()&os.ModeSocket != 0
	}, 2*time.Second, 10*time.Millisecond, "socket should replace stale file")

	cancel()
	<-errCh
}
