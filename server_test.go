package ts

import (
	"context"
	"fmt"
	"testing"

	io "dappco.re/go/core/io"
	"dappco.re/go/core/io/store"
	"dappco.re/go/core/scm/manifest"
	pb "dappco.re/go/core/ts/proto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// mockProcessRunner implements ProcessRunner for testing.
type mockProcessRunner struct {
	started map[string]bool
	nextID  int
}

func newMockProcessRunner() *mockProcessRunner {
	return &mockProcessRunner{started: make(map[string]bool)}
}

func (m *mockProcessRunner) Start(_ context.Context, command string, args ...string) (ProcessHandle, error) {
	m.nextID++
	id := fmt.Sprintf("proc-%d", m.nextID)
	m.started[id] = true
	return &mockProcessHandle{id: id}, nil
}

func (m *mockProcessRunner) Kill(id string) error {
	if !m.started[id] {
		return fmt.Errorf("process not found: %s", id)
	}
	delete(m.started, id)
	return nil
}

type mockProcessHandle struct{ id string }

func (h *mockProcessHandle) Info() ProcessInfo { return ProcessInfo{ID: h.id} }

func newTestServer(t *testing.T) *Server {
	t.Helper()
	medium := io.NewMockMedium()
	medium.Files["./data/test.txt"] = "hello"
	st, err := store.New(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { st.Close() })

	srv := NewServer(medium, st)
	srv.RegisterModule(&manifest.Manifest{
		Code: "test-mod",
		Permissions: manifest.Permissions{
			Read:  []string{"./data/"},
			Write: []string{"./data/"},
		},
	})
	return srv
}

func TestFileRead_Good(t *testing.T) {
	srv := newTestServer(t)
	resp, err := srv.FileRead(context.Background(), &pb.FileReadRequest{
		Path: "./data/test.txt", ModuleCode: "test-mod",
	})
	require.NoError(t, err)
	assert.Equal(t, "hello", resp.Content)
}

func TestPing_Good(t *testing.T) {
	srv := newTestServer(t)
	resp, err := srv.Ping(context.Background(), &pb.PingRequest{})
	require.NoError(t, err)
	assert.True(t, resp.Ok)
}

func TestFileRead_Bad_PermissionDenied(t *testing.T) {
	srv := newTestServer(t)
	_, err := srv.FileRead(context.Background(), &pb.FileReadRequest{
		Path: "./secrets/key.pem", ModuleCode: "test-mod",
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "permission denied")
}

func TestFileRead_Bad_UnknownModule(t *testing.T) {
	srv := newTestServer(t)
	_, err := srv.FileRead(context.Background(), &pb.FileReadRequest{
		Path: "./data/test.txt", ModuleCode: "unknown",
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unknown module")
}

func TestFileWrite_Good(t *testing.T) {
	srv := newTestServer(t)
	resp, err := srv.FileWrite(context.Background(), &pb.FileWriteRequest{
		Path: "./data/new.txt", Content: "world", ModuleCode: "test-mod",
	})
	require.NoError(t, err)
	assert.True(t, resp.Ok)
}

func TestFileWrite_Bad_PermissionDenied(t *testing.T) {
	srv := newTestServer(t)
	_, err := srv.FileWrite(context.Background(), &pb.FileWriteRequest{
		Path: "./secrets/bad.txt", Content: "nope", ModuleCode: "test-mod",
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "permission denied")
}

func TestStoreGetSet_Good(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()

	_, err := srv.StoreSet(ctx, &pb.StoreSetRequest{Group: "cfg", Key: "theme", Value: "dark"})
	require.NoError(t, err)

	resp, err := srv.StoreGet(ctx, &pb.StoreGetRequest{Group: "cfg", Key: "theme"})
	require.NoError(t, err)
	assert.True(t, resp.Found)
	assert.Equal(t, "dark", resp.Value)
}

func TestStoreGetSet_Good_ModuleNamespace(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()

	_, err := srv.StoreSet(ctx, &pb.StoreSetRequest{
		Group:      "shared",
		Key:        "theme",
		Value:      "dark",
		ModuleCode: "test-mod",
	})
	require.NoError(t, err)

	resp, err := srv.StoreGet(ctx, &pb.StoreGetRequest{
		Group:      "shared",
		Key:        "theme",
		ModuleCode: "test-mod",
	})
	require.NoError(t, err)
	assert.True(t, resp.Found)
	assert.Equal(t, "dark", resp.Value)
}

func TestStoreGetSet_Bad_ReservedGroup(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()

	_, err := srv.StoreSet(ctx, &pb.StoreSetRequest{
		Group:      "_coredeno",
		Key:        "theme",
		Value:      "dark",
		ModuleCode: "test-mod",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "reserved store group")
}

func TestStoreGet_Good_NotFound(t *testing.T) {
	srv := newTestServer(t)
	resp, err := srv.StoreGet(context.Background(), &pb.StoreGetRequest{Group: "cfg", Key: "missing"})
	require.NoError(t, err)
	assert.False(t, resp.Found)
}

func newTestServerWithProcess(t *testing.T) (*Server, *mockProcessRunner) {
	t.Helper()
	srv := newTestServer(t)
	srv.RegisterModule(&manifest.Manifest{
		Code: "runner-mod",
		Permissions: manifest.Permissions{
			Run: []string{"echo", "ls"},
		},
	})
	pr := newMockProcessRunner()
	srv.SetProcessRunner(pr)
	return srv, pr
}

func TestProcessStart_Good(t *testing.T) {
	srv, _ := newTestServerWithProcess(t)
	resp, err := srv.ProcessStart(context.Background(), &pb.ProcessStartRequest{
		Command: "echo", Args: []string{"hello"}, ModuleCode: "runner-mod",
	})
	require.NoError(t, err)
	assert.NotEmpty(t, resp.ProcessId)
}

func TestProcessStart_Bad_PermissionDenied(t *testing.T) {
	srv, _ := newTestServerWithProcess(t)
	_, err := srv.ProcessStart(context.Background(), &pb.ProcessStartRequest{
		Command: "rm", Args: []string{"-rf", "/"}, ModuleCode: "runner-mod",
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "permission denied")
}

func TestProcessStart_Bad_NoProcessService(t *testing.T) {
	srv := newTestServer(t)
	srv.RegisterModule(&manifest.Manifest{
		Code:        "no-proc-mod",
		Permissions: manifest.Permissions{Run: []string{"echo"}},
	})
	_, err := srv.ProcessStart(context.Background(), &pb.ProcessStartRequest{
		Command: "echo", ModuleCode: "no-proc-mod",
	})
	assert.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.Unimplemented, st.Code())
}

func TestProcessStop_Good(t *testing.T) {
	srv, _ := newTestServerWithProcess(t)
	// Start a process first
	startResp, err := srv.ProcessStart(context.Background(), &pb.ProcessStartRequest{
		Command: "echo", ModuleCode: "runner-mod",
	})
	require.NoError(t, err)

	// Stop it
	resp, err := srv.ProcessStop(context.Background(), &pb.ProcessStopRequest{
		ProcessId:  startResp.ProcessId,
		ModuleCode: "runner-mod",
	})
	require.NoError(t, err)
	assert.True(t, resp.Ok)
}

func TestProcessStop_Bad_NotFound(t *testing.T) {
	srv, _ := newTestServerWithProcess(t)
	_, err := srv.ProcessStop(context.Background(), &pb.ProcessStopRequest{
		ProcessId: "nonexistent",
	})
	assert.Error(t, err)
}

func TestProcessStop_Bad_NoOwnerMapping(t *testing.T) {
	srv, _ := newTestServerWithProcess(t)
	_, err := srv.ProcessStop(context.Background(), &pb.ProcessStopRequest{
		ProcessId:  "missing",
		ModuleCode: "runner-mod",
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "permission denied")
}

func TestProcessStop_Bad_OtherModule(t *testing.T) {
	srv, _ := newTestServerWithProcess(t)
	srv.RegisterModule(&manifest.Manifest{
		Code:        "other-mod",
		Permissions: manifest.Permissions{Run: []string{"echo"}},
	})

	startResp, err := srv.ProcessStart(context.Background(), &pb.ProcessStartRequest{
		Command: "echo", ModuleCode: "runner-mod",
	})
	require.NoError(t, err)

	_, err = srv.ProcessStop(context.Background(), &pb.ProcessStopRequest{
		ProcessId:  startResp.ProcessId,
		ModuleCode: "other-mod",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "permission denied")
}
