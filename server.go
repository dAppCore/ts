package ts

import (
	"context"
	"errors"
	"fmt"
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
	s.mu.Lock()
	defer s.mu.Unlock()
	s.manifests[m.Code] = m
}

// getManifest looks up a module and returns an error if unknown.
func (s *Server) getManifest(code string) (*manifest.Manifest, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m, ok := s.manifests[code]
	if !ok {
		return nil, fmt.Errorf("unknown module: %s", code)
	}
	return m, nil
}

// Ping implements CoreService.Ping for sidecar health checks.
func (s *Server) Ping(_ context.Context, _ *pb.PingRequest) (*pb.PingResponse, error) {
	return &pb.PingResponse{Ok: true}, nil
}

// FileRead implements CoreService.FileRead with permission gating.
func (s *Server) FileRead(_ context.Context, req *pb.FileReadRequest) (*pb.FileReadResponse, error) {
	m, err := s.getManifest(req.ModuleCode)
	if err != nil {
		return nil, err
	}
	if !CheckPath(req.Path, m.Permissions.Read) {
		return nil, fmt.Errorf("permission denied: %s cannot read %s", req.ModuleCode, req.Path)
	}
	content, err := s.medium.Read(req.Path)
	if err != nil {
		return nil, err
	}
	return &pb.FileReadResponse{Content: content}, nil
}

// FileWrite implements CoreService.FileWrite with permission gating.
func (s *Server) FileWrite(_ context.Context, req *pb.FileWriteRequest) (*pb.FileWriteResponse, error) {
	m, err := s.getManifest(req.ModuleCode)
	if err != nil {
		return nil, err
	}
	if !CheckPath(req.Path, m.Permissions.Write) {
		return nil, fmt.Errorf("permission denied: %s cannot write %s", req.ModuleCode, req.Path)
	}
	if err := s.medium.Write(req.Path, req.Content); err != nil {
		return nil, err
	}
	return &pb.FileWriteResponse{Ok: true}, nil
}

// FileList implements CoreService.FileList with permission gating.
func (s *Server) FileList(_ context.Context, req *pb.FileListRequest) (*pb.FileListResponse, error) {
	m, err := s.getManifest(req.ModuleCode)
	if err != nil {
		return nil, err
	}
	if !CheckPath(req.Path, m.Permissions.Read) {
		return nil, fmt.Errorf("permission denied: %s cannot list %s", req.ModuleCode, req.Path)
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
	return &pb.FileListResponse{Entries: pbEntries}, nil
}

// FileDelete implements CoreService.FileDelete with permission gating.
func (s *Server) FileDelete(_ context.Context, req *pb.FileDeleteRequest) (*pb.FileDeleteResponse, error) {
	m, err := s.getManifest(req.ModuleCode)
	if err != nil {
		return nil, err
	}
	if !CheckPath(req.Path, m.Permissions.Write) {
		return nil, fmt.Errorf("permission denied: %s cannot delete %s", req.ModuleCode, req.Path)
	}
	if err := s.medium.Delete(req.Path); err != nil {
		return nil, err
	}
	return &pb.FileDeleteResponse{Ok: true}, nil
}

// storeGroupAllowed checks that the requested group is not a reserved system namespace.
// Groups prefixed with "_" are reserved for internal use (e.g. _coredeno, _modules).
// When moduleCode is set, the module can only access its own namespace.
func storeGroupAllowed(group, moduleCode string) error {
	if strings.HasPrefix(group, "_") {
		return status.Errorf(codes.PermissionDenied, "reserved store group: %s", group)
	}
	if moduleCode == "" {
		return nil
	}
	if group == moduleCode || strings.HasPrefix(group, moduleCode+".") {
		return nil
	}
	return status.Errorf(codes.PermissionDenied, "module %s cannot access store group %s", moduleCode, group)
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
	m, err := s.getManifest(req.ModuleCode)
	if err != nil {
		return nil, err
	}
	if !CheckRun(req.Command, m.Permissions.Run) {
		return nil, fmt.Errorf("permission denied: %s cannot run %s", req.ModuleCode, req.Command)
	}
	proc, err := s.processes.Start(ctx, req.Command, req.Args...)
	if err != nil {
		return nil, fmt.Errorf("process start: %w", err)
	}
	processID := proc.Info().ID
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

	if req.ModuleCode != "" {
		s.mu.RLock()
		owner, ok := s.processOwners[req.ProcessId]
		s.mu.RUnlock()
		if !ok {
			return nil, fmt.Errorf("permission denied: %s cannot stop %s", req.ModuleCode, req.ProcessId)
		}
		if owner != req.ModuleCode {
			return nil, fmt.Errorf("permission denied: %s cannot stop %s", req.ModuleCode, req.ProcessId)
		}
	}

	if err := s.processes.Kill(req.ProcessId); err != nil {
		return nil, fmt.Errorf("process stop: %w", err)
	}
	s.mu.Lock()
	delete(s.processOwners, req.ProcessId)
	s.mu.Unlock()
	return &pb.ProcessStopResponse{Ok: true}, nil
}
