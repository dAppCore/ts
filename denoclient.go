package ts

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"sync"
)

// DenoClient communicates with the Deno sidecar's JSON-RPC server over a Unix socket.
// Thread-safe: uses a mutex to serialize requests (one connection, request/response protocol).
type DenoClient struct {
	mu     sync.Mutex
	conn   net.Conn
	reader *bufio.Reader
}

// DialDeno connects to the Deno JSON-RPC server on the given Unix socket path.
func DialDeno(socketPath string) (*DenoClient, error) {
	conn, err := net.Dial("unix", socketPath)
	if err != nil {
		return nil, fmt.Errorf("deno dial: %w", err)
	}
	return &DenoClient{
		conn:   conn,
		reader: bufio.NewReader(conn),
	}, nil
}

// Close closes the underlying connection.
func (c *DenoClient) Close() error {
	return c.conn.Close()
}

func (c *DenoClient) call(req map[string]any) (map[string]any, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	data, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal: %w", err)
	}
	data = append(data, '\n')

	if _, err := c.conn.Write(data); err != nil {
		return nil, fmt.Errorf("write: %w", err)
	}

	line, err := c.reader.ReadBytes('\n')
	if err != nil {
		return nil, fmt.Errorf("read: %w", err)
	}

	var resp map[string]any
	if err := json.Unmarshal(line, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}

	if errMsg, ok := resp["error"].(string); ok && errMsg != "" {
		return nil, fmt.Errorf("deno: %s", errMsg)
	}
	return resp, nil
}

// ModulePermissions declares per-module permission scopes for Deno Worker sandboxing.
type ModulePermissions struct {
	Read  []string `json:"read,omitempty"`
	Write []string `json:"write,omitempty"`
	Net   []string `json:"net,omitempty"`
	Run   []string `json:"run,omitempty"`
}

// LoadModuleResponse holds the result of a LoadModule call.
type LoadModuleResponse struct {
	Ok    bool
	Error string
}

// LoadModule tells Deno to load a module with the given permissions.
func (c *DenoClient) LoadModule(code, entryPoint string, perms ModulePermissions) (*LoadModuleResponse, error) {
	resp, err := c.call(map[string]any{
		"method":      "LoadModule",
		"code":        code,
		"entry_point": entryPoint,
		"permissions": perms,
	})
	if err != nil {
		return nil, err
	}
	errStr, _ := resp["error"].(string)
	return &LoadModuleResponse{
		Ok:    resp["ok"] == true,
		Error: errStr,
	}, nil
}

// UnloadModuleResponse holds the result of an UnloadModule call.
type UnloadModuleResponse struct {
	Ok bool
}

// UnloadModule tells Deno to unload a module.
func (c *DenoClient) UnloadModule(code string) (*UnloadModuleResponse, error) {
	resp, err := c.call(map[string]any{
		"method": "UnloadModule",
		"code":   code,
	})
	if err != nil {
		return nil, err
	}
	return &UnloadModuleResponse{
		Ok: resp["ok"] == true,
	}, nil
}

// ModuleStatusResponse holds the result of a ModuleStatus call.
type ModuleStatusResponse struct {
	Code   string
	Status string
}

// ModuleStatus queries the status of a module in the Deno runtime.
func (c *DenoClient) ModuleStatus(code string) (*ModuleStatusResponse, error) {
	resp, err := c.call(map[string]any{
		"method": "ModuleStatus",
		"code":   code,
	})
	if err != nil {
		return nil, err
	}
	respCode, _ := resp["code"].(string)
	sts, _ := resp["status"].(string)
	return &ModuleStatusResponse{
		Code:   respCode,
		Status: sts,
	}, nil
}
