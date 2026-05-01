package ts

import (
	"context"
	"errors"
	"fmt"
	"testing"

	io "dappco.re/go/io"
	"dappco.re/go/io/store"
	"dappco.re/go/scm/manifest"
	pb "dappco.re/go/ts/proto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// mockProcessRunner implements ProcessRunner for testing.
type mockProcessRunner struct {
	started  map[string]bool
	nextID   int
	startErr error
	killErr  error
}

func newMockProcessRunner() *mockProcessRunner {
	return &mockProcessRunner{started: make(map[string]bool)}
}

func (m *mockProcessRunner) Start(_ context.Context, command string, args ...string) (ProcessHandle, error) {
	if m.startErr != nil {
		return nil, m.startErr
	}
	if m.started == nil {
		m.started = make(map[string]bool)
	}
	m.nextID++
	id := fmt.Sprintf("proc-%d", m.nextID)
	m.started[id] = true
	return &mockProcessHandle{id: id}, nil
}

func (m *mockProcessRunner) Kill(id string) error {
	if m.killErr != nil {
		return m.killErr
	}
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

func TestLocaleGet_Good(t *testing.T) {
	medium := io.NewMockMedium()
	medium.Files[".core/locales/en.json"] = `{"hello":"world"}`
	st, err := store.New(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { st.Close() })
	srv := NewServer(medium, st)

	resp, err := srv.LocaleGet(context.Background(), &pb.LocaleGetRequest{Locale: "en"})
	require.NoError(t, err)
	assert.True(t, resp.Found)
	assert.Equal(t, `{"hello":"world"}`, resp.Content)
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

func TestFileList_Good(t *testing.T) {
	medium := io.NewMockMedium()
	medium.Files["./data/a.txt"] = "hello"
	medium.Files["./data/sub/b.txt"] = "world"

	st, err := store.New(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { st.Close() })

	srv := NewServer(medium, st)
	srv.RegisterModule(&manifest.Manifest{
		Code: "list-mod",
		Permissions: manifest.Permissions{
			Read: []string{"./data/"},
		},
	})

	resp, err := srv.FileList(context.Background(), &pb.FileListRequest{
		Path:       "./data",
		ModuleCode: "list-mod",
	})
	require.NoError(t, err)
	require.Len(t, resp.Entries, 2)
	assert.Equal(t, "a.txt", resp.Entries[0].Name)
	assert.False(t, resp.Entries[0].IsDir)
	assert.EqualValues(t, len("hello"), resp.Entries[0].Size)
	assert.Equal(t, "sub", resp.Entries[1].Name)
	assert.True(t, resp.Entries[1].IsDir)
}

func TestFileList_Bad_PermissionDenied(t *testing.T) {
	srv := newTestServer(t)
	_, err := srv.FileList(context.Background(), &pb.FileListRequest{
		Path:       "./secrets",
		ModuleCode: "test-mod",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "permission denied")
}

func TestFileList_Ugly_UnknownModule(t *testing.T) {
	srv := newTestServer(t)
	_, err := srv.FileList(context.Background(), &pb.FileListRequest{
		Path:       "./data",
		ModuleCode: "missing",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown module")
}

func TestFileDelete_Good(t *testing.T) {
	srv := newTestServer(t)
	require.NotNil(t, srv)
	medium := srv.medium.(*io.MockMedium)
	medium.Files["./data/delete-me.txt"] = "bye"

	resp, err := srv.FileDelete(context.Background(), &pb.FileDeleteRequest{
		Path:       "./data/delete-me.txt",
		ModuleCode: "test-mod",
	})
	require.NoError(t, err)
	assert.True(t, resp.Ok)
	_, err = srv.FileRead(context.Background(), &pb.FileReadRequest{
		Path:       "./data/delete-me.txt",
		ModuleCode: "test-mod",
	})
	assert.Error(t, err)
}

func TestFileDelete_Bad_PermissionDenied(t *testing.T) {
	srv := newTestServer(t)
	_, err := srv.FileDelete(context.Background(), &pb.FileDeleteRequest{
		Path:       "./secrets/delete-me.txt",
		ModuleCode: "test-mod",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "permission denied")
}

func TestFileDelete_Ugly_UnknownModule(t *testing.T) {
	srv := newTestServer(t)
	_, err := srv.FileDelete(context.Background(), &pb.FileDeleteRequest{
		Path:       "./data/delete-me.txt",
		ModuleCode: "missing",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown module")
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

func TestProcessStart_Bad_MissingIdentity(t *testing.T) {
	srv, _ := newTestServerWithProcess(t)
	_, err := srv.ProcessStart(context.Background(), &pb.ProcessStartRequest{
		Command: "echo",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "module code required")
}

func TestProcessStart_Bad_BlankCommand(t *testing.T) {
	srv, _ := newTestServerWithProcess(t)
	_, err := srv.ProcessStart(context.Background(), &pb.ProcessStartRequest{
		Command:    "   ",
		ModuleCode: "runner-mod",
	})
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.InvalidArgument, st.Code())
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

func TestProcessStop_Bad_RequiresModuleCode(t *testing.T) {
	srv, _ := newTestServerWithProcess(t)
	_, err := srv.ProcessStop(context.Background(), &pb.ProcessStopRequest{
		ProcessId: "nonexistent",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "module code required")
}

func TestProcessStop_Bad_BlankProcessID(t *testing.T) {
	srv, _ := newTestServerWithProcess(t)
	_, err := srv.ProcessStop(context.Background(), &pb.ProcessStopRequest{
		ProcessId:  "   ",
		ModuleCode: "runner-mod",
	})
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.InvalidArgument, st.Code())
}

func TestProcessStop_Bad_OwnershipMismatch(t *testing.T) {
	srv, _ := newTestServerWithProcess(t)
	startResp, err := srv.ProcessStart(context.Background(), &pb.ProcessStartRequest{
		Command: "echo", ModuleCode: "runner-mod",
	})
	require.NoError(t, err)

	_, err = srv.ProcessStop(context.Background(), &pb.ProcessStopRequest{
		ProcessId:  startResp.ProcessId,
		ModuleCode: "other-mod",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "cannot stop")
}

func TestProcessStop_Bad_NotFound(t *testing.T) {
	srv, _ := newTestServerWithProcess(t)
	_, err := srv.ProcessStop(context.Background(), &pb.ProcessStopRequest{
		ProcessId:  "nonexistent",
		ModuleCode: "runner-mod",
	})
	assert.Error(t, err)
}

func TestProcessStop_Bad_MissingModuleCode(t *testing.T) {
	srv, _ := newTestServerWithProcess(t)
	_, err := srv.ProcessStop(context.Background(), &pb.ProcessStopRequest{
		ProcessId: "nonexistent",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "module code required")
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

func TestUnregisterModule_Good_ClearsProcessOwnership(t *testing.T) {
	srv, _ := newTestServerWithProcess(t)

	startResp, err := srv.ProcessStart(context.Background(), &pb.ProcessStartRequest{
		Command: "echo", ModuleCode: "runner-mod",
	})
	require.NoError(t, err)
	require.NotEmpty(t, startResp.ProcessId)

	srv.UnregisterModule("runner-mod")

	srv.mu.RLock()
	_, stillTracked := srv.processOwners[startResp.ProcessId]
	srv.mu.RUnlock()
	assert.False(t, stillTracked, "process ownership should be removed when the module is unregistered")

	_, err = srv.ProcessStop(context.Background(), &pb.ProcessStopRequest{
		ProcessId:  startResp.ProcessId,
		ModuleCode: "runner-mod",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "permission denied")
}

func TestServer_RegisterModule_Ugly_NilAndBlankIgnored(t *testing.T) {
	srv := newTestServer(t)

	before := len(srv.manifests)
	srv.RegisterModule(nil)
	srv.RegisterModule(&manifest.Manifest{Code: "   "})

	srv.mu.RLock()
	defer srv.mu.RUnlock()
	assert.Len(t, srv.manifests, before)
}

func TestServer_UnregisterModule_Ugly_BlankNoop(t *testing.T) {
	srv := newTestServer(t)
	srv.RegisterModule(&manifest.Manifest{Code: "keep-me"})

	srv.UnregisterModule("   ")

	srv.mu.RLock()
	defer srv.mu.RUnlock()
	_, ok := srv.manifests["keep-me"]
	assert.True(t, ok)
}

func TestServer_ProcessStart_Bad_ProcessServiceUnavailable(t *testing.T) {
	srv, _ := newTestServerWithProcess(t)
	srv.SetProcessRunner(&mockProcessRunner{startErr: errProcessUnavailable})

	_, err := srv.ProcessStart(context.Background(), &pb.ProcessStartRequest{
		Command:    "echo",
		ModuleCode: "runner-mod",
	})
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.Unimplemented, st.Code())
}

func TestServer_ProcessStart_Bad_StartErrorWrapped(t *testing.T) {
	srv, _ := newTestServerWithProcess(t)
	srv.SetProcessRunner(&mockProcessRunner{startErr: errors.New("start failed")})

	_, err := srv.ProcessStart(context.Background(), &pb.ProcessStartRequest{
		Command:    "echo",
		ModuleCode: "runner-mod",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "process start")
	assert.Contains(t, err.Error(), "start failed")
}

func TestServer_ProcessStop_Bad_KillErrorWrapped(t *testing.T) {
	srv, _ := newTestServerWithProcess(t)
	runner := &mockProcessRunner{killErr: errors.New("kill failed")}
	srv.SetProcessRunner(runner)

	startResp, err := srv.ProcessStart(context.Background(), &pb.ProcessStartRequest{
		Command:    "echo",
		ModuleCode: "runner-mod",
	})
	require.NoError(t, err)

	_, err = srv.ProcessStop(context.Background(), &pb.ProcessStopRequest{
		ProcessId:  startResp.ProcessId,
		ModuleCode: "runner-mod",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "process stop")
	assert.Contains(t, err.Error(), "kill failed")
}

func TestServer_ProcessStart_Bad_EmptyCommand(t *testing.T) {
	srv, _ := newTestServerWithProcess(t)

	_, err := srv.ProcessStart(context.Background(), &pb.ProcessStartRequest{
		Command:    "   ",
		ModuleCode: "runner-mod",
	})
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.InvalidArgument, st.Code())
	assert.Contains(t, st.Message(), "process command required")
}

func TestServer_ProcessStart_Ugly_MissingModuleCode(t *testing.T) {
	srv, _ := newTestServerWithProcess(t)

	_, err := srv.ProcessStart(context.Background(), &pb.ProcessStartRequest{
		Command: "echo",
	})
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.PermissionDenied, st.Code())
	assert.Contains(t, st.Message(), "module code required")
}

func TestServer_ProcessStop_Good_OwnershipCleared(t *testing.T) {
	srv, _ := newTestServerWithProcess(t)

	startResp, err := srv.ProcessStart(context.Background(), &pb.ProcessStartRequest{
		Command:    "echo",
		ModuleCode: "runner-mod",
	})
	require.NoError(t, err)
	require.NotEmpty(t, startResp.ProcessId)

	stopResp, err := srv.ProcessStop(context.Background(), &pb.ProcessStopRequest{
		ProcessId:  startResp.ProcessId,
		ModuleCode: "runner-mod",
	})
	require.NoError(t, err)
	assert.True(t, stopResp.Ok)

	_, err = srv.ProcessStop(context.Background(), &pb.ProcessStopRequest{
		ProcessId:  startResp.ProcessId,
		ModuleCode: "runner-mod",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "permission denied")
}

func TestServer_ProcessStop_Bad_OwnershipDenied(t *testing.T) {
	srv, _ := newTestServerWithProcess(t)

	startResp, err := srv.ProcessStart(context.Background(), &pb.ProcessStartRequest{
		Command:    "echo",
		ModuleCode: "runner-mod",
	})
	require.NoError(t, err)

	_, err = srv.ProcessStop(context.Background(), &pb.ProcessStopRequest{
		ProcessId:  startResp.ProcessId,
		ModuleCode: "other-mod",
	})
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.PermissionDenied, st.Code())
	assert.Contains(t, st.Message(), "cannot stop")
}

func TestServer_ProcessStop_Ugly_NoRunner(t *testing.T) {
	srv := newTestServer(t)

	_, err := srv.ProcessStop(context.Background(), &pb.ProcessStopRequest{
		ProcessId:  "proc-1",
		ModuleCode: "test-mod",
	})
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.Unimplemented, st.Code())
}
