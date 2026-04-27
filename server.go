package ts

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"

	io "dappco.re/go/core/io"
	"dappco.re/go/core/io/store"
	"dappco.re/go/core/scm/manifest"
	pb "dappco.re/go/core/ts/proto"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// ProcessRunner abstracts process management for the gRPC server.
// Satisfied by *process.Service.
type ProcessRunner interface {
	Start(ctx context.Context, command string, args ...string) (ProcessHandle, error)
	Kill(id string) error
}

// ProcessHandle is returned by ProcessRunner.Start.
type ProcessHandle interface {
	Info() ProcessInfo
}

// ProcessInfo is the subset of process info the server needs.
type ProcessInfo struct {
	ID string
}

// Server implements the CoreService gRPC interface with permission gating.
// Every I/O request is checked against the calling module's declared permissions.
type Server struct {
	pb.UnimplementedCoreServiceServer
	mu            sync.RWMutex
	medium        io.Medium
	store         *store.Store
	manifests     map[string]*manifest.Manifest
	processOwners map[string]string
	processes     ProcessRunner
}

// NewServer creates a CoreService server backed by the given Medium and Store.
func NewServer(medium io.Medium, st *store.Store) *Server {
	return &Server{
		medium:        medium,
		store:         st,
		manifests:     make(map[string]*manifest.Manifest),
		processOwners: make(map[string]string),
	}
}

// RegisterModule adds a module's manifest to the permission registry.
func (s *Server) RegisterModule(m *manifest.Manifest) {
	if m == nil || strings.TrimSpace(m.Code) == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.manifests[m.Code] = m
}

// UnregisterModule removes a module from the permission registry.
func (s *Server) UnregisterModule(code string) {
	if strings.TrimSpace(code) == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.manifests, code)

	// Clear any process ownership entries tied to this module so unloads do not
	// leave stale authorisation state behind.
	for processID, ownerCode := range s.processOwners {
		if ownerCode == code {
			delete(s.processOwners, processID)
		}
	}
}

// getManifest looks up a module and returns an error if unknown.
func (s *Server) getManifest(code string) (*manifest.Manifest, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	moduleManifest, ok := s.manifests[code]
	if !ok {
		return nil, status.Errorf(codes.NotFound, "unknown module: %s", code)
	}
	return moduleManifest, nil
}

// Ping implements CoreService.Ping for sidecar health checks.
func (s *Server) Ping(_ context.Context, _ *pb.PingRequest) (*pb.PingResponse, error) {
	return &pb.PingResponse{Ok: true}, nil
}

// FileRead implements CoreService.FileRead with permission gating.
func (s *Server) FileRead(_ context.Context, req *pb.FileReadRequest) (*pb.FileReadResponse, error) {
	moduleManifest, err := s.getManifest(req.ModuleCode)
	if err != nil {
		return nil, err
	}
	if !CheckPath(req.Path, moduleManifest.Permissions.Read) {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied: %s cannot read %s", req.ModuleCode, req.Path)
	}
	content, err := s.medium.Read(req.Path)
	if err != nil {
		return nil, err
	}
	return &pb.FileReadResponse{Content: content}, nil
}

// FileWrite implements CoreService.FileWrite with permission gating.
func (s *Server) FileWrite(_ context.Context, req *pb.FileWriteRequest) (*pb.FileWriteResponse, error) {
	moduleManifest, err := s.getManifest(req.ModuleCode)
	if err != nil {
		return nil, err
	}
	if !CheckPath(req.Path, moduleManifest.Permissions.Write) {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied: %s cannot write %s", req.ModuleCode, req.Path)
	}
	if err := s.medium.Write(req.Path, req.Content); err != nil {
		return nil, err
	}
	return &pb.FileWriteResponse{Ok: true}, nil
}

// FileList implements CoreService.FileList with permission gating.
func (s *Server) FileList(_ context.Context, req *pb.FileListRequest) (*pb.FileListResponse, error) {
	moduleManifest, err := s.getManifest(req.ModuleCode)
	if err != nil {
		return nil, err
	}
	if !CheckPath(req.Path, moduleManifest.Permissions.Read) {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied: %s cannot list %s", req.ModuleCode, req.Path)
	}
	entries, err := s.medium.List(req.Path)
	if err != nil {
		return nil, err
	}
	var pbEntries []*pb.FileEntry
	for _, e := range entries {
		info, _ := e.Info()
		pbEntries = append(pbEntries, &pb.FileEntry{
			Name:  e.Name(),
			IsDir: e.IsDir(),
			Size:  info.Size(),
		})
	}
	sort.SliceStable(pbEntries, func(i, j int) bool {
		return pbEntries[i].Name < pbEntries[j].Name
	})
	return &pb.FileListResponse{Entries: pbEntries}, nil
}

// FileDelete implements CoreService.FileDelete with permission gating.
func (s *Server) FileDelete(_ context.Context, req *pb.FileDeleteRequest) (*pb.FileDeleteResponse, error) {
	moduleManifest, err := s.getManifest(req.ModuleCode)
	if err != nil {
		return nil, err
	}
	if !CheckPath(req.Path, moduleManifest.Permissions.Write) {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied: %s cannot delete %s", req.ModuleCode, req.Path)
	}
	if err := s.medium.Delete(req.Path); err != nil {
		return nil, err
	}
	return &pb.FileDeleteResponse{Ok: true}, nil
}

// storeGroupAllowed checks that the requested group is not a reserved system namespace.
// Groups prefixed with "_" are reserved for internal use (e.g. _coredeno, _modules).
// The caller's module code is included for audit/context only; non-reserved groups are allowed.
func storeGroupAllowed(group, _ string) error {
	if strings.HasPrefix(group, "_") {
		return status.Errorf(codes.PermissionDenied, "reserved store group: %s", group)
	}
	return nil
}

// StoreGet implements CoreService.StoreGet with reserved namespace protection.
func (s *Server) StoreGet(_ context.Context, req *pb.StoreGetRequest) (*pb.StoreGetResponse, error) {
	if err := storeGroupAllowed(req.Group, req.ModuleCode); err != nil {
		return nil, err
	}
	val, err := s.store.Get(req.Group, req.Key)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return &pb.StoreGetResponse{Found: false}, nil
		}
		return nil, status.Errorf(codes.Internal, "store: %v", err)
	}
	return &pb.StoreGetResponse{Value: val, Found: true}, nil
}

// StoreSet implements CoreService.StoreSet with reserved namespace protection.
func (s *Server) StoreSet(_ context.Context, req *pb.StoreSetRequest) (*pb.StoreSetResponse, error) {
	if err := storeGroupAllowed(req.Group, req.ModuleCode); err != nil {
		return nil, err
	}
	if err := s.store.Set(req.Group, req.Key, req.Value); err != nil {
		return nil, err
	}
	return &pb.StoreSetResponse{Ok: true}, nil
}

// SetProcessRunner sets the process runner for ProcessStart/ProcessStop.
func (s *Server) SetProcessRunner(pr ProcessRunner) {
	s.processes = pr
}

// ProcessStart implements CoreService.ProcessStart with permission gating.
func (s *Server) ProcessStart(ctx context.Context, req *pb.ProcessStartRequest) (*pb.ProcessStartResponse, error) {
	if s.processes == nil {
		return nil, status.Error(codes.Unimplemented, "process service not available")
	}
	if strings.TrimSpace(req.ModuleCode) == "" {
		return nil, status.Error(codes.PermissionDenied, "permission denied: module code required to start processes")
	}
	if strings.TrimSpace(req.Command) == "" {
		return nil, status.Error(codes.InvalidArgument, "process command required")
	}
	moduleManifest, err := s.getManifest(req.ModuleCode)
	if err != nil {
		return nil, err
	}
	if !CheckRun(req.Command, moduleManifest.Permissions.Run) {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied: %s cannot run %s", req.ModuleCode, req.Command)
	}
	processHandle, err := s.processes.Start(ctx, req.Command, req.Args...)
	if err != nil {
		if errors.Is(err, errProcessUnavailable) {
			return nil, status.Error(codes.Unimplemented, "process service not available")
		}
		return nil, fmt.Errorf("process start: %w", err)
	}
	processID := processHandle.Info().ID
	s.mu.Lock()
	s.processOwners[processID] = req.ModuleCode
	s.mu.Unlock()
	return &pb.ProcessStartResponse{ProcessId: processID}, nil
}

// ProcessStop implements CoreService.ProcessStop.
func (s *Server) ProcessStop(_ context.Context, req *pb.ProcessStopRequest) (*pb.ProcessStopResponse, error) {
	if s.processes == nil {
		return nil, status.Error(codes.Unimplemented, "process service not available")
	}
	if strings.TrimSpace(req.ModuleCode) == "" {
		return nil, status.Error(codes.PermissionDenied, "permission denied: module code required to stop processes")
	}
	if strings.TrimSpace(req.ProcessId) == "" {
		return nil, status.Error(codes.InvalidArgument, "process id required")
	}

	s.mu.RLock()
	owner, ok := s.processOwners[req.ProcessId]
	s.mu.RUnlock()
	if !ok {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied: %s cannot stop %s", req.ModuleCode, req.ProcessId)
	}
	if owner != req.ModuleCode {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied: %s cannot stop %s", req.ModuleCode, req.ProcessId)
	}

	if err := s.processes.Kill(req.ProcessId); err != nil {
		if errors.Is(err, errProcessUnavailable) {
			return nil, status.Error(codes.Unimplemented, "process service not available")
		}
		return nil, fmt.Errorf("process stop: %w", err)
	}
	s.clearProcessOwner(req.ProcessId)
	return &pb.ProcessStopResponse{Ok: true}, nil
}

func (s *Server) clearProcessOwner(processID string) {
	s.mu.Lock()
	delete(s.processOwners, processID)
	s.mu.Unlock()
}
