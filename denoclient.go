package ts

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"sync"
	"time"
)

// DenoClient communicates with the Deno sidecar's JSON-RPC server over a Unix socket.
// Thread-safe: uses a mutex to serialize requests (one connection, request/response protocol).
type DenoClient struct {
	mu     sync.Mutex
	conn   net.Conn
	reader *bufio.Reader
	nextID int64
}

const (
	denoPingTimeout         = 2 * time.Second
	denoModuleLoadTimeout   = 10 * time.Second
	denoModuleStopTimeout   = 5 * time.Second
	denoModuleStatusTimeout = 2 * time.Second
	maxJSONLineBytes        = 1 << 20
)

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
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn == nil {
		return nil
	}

	err := c.conn.Close()
	c.conn = nil
	c.reader = nil
	return err
}

func (c *DenoClient) call(req map[string]any, timeout time.Duration) (map[string]any, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn == nil || c.reader == nil {
		return nil, fmt.Errorf("deno: client closed")
	}

	if timeout <= 0 {
		timeout = denoPingTimeout
	}

	if err := c.conn.SetDeadline(time.Now().Add(timeout)); err != nil {
		return nil, fmt.Errorf("deadline: %w", err)
	}
	defer func() {
		_ = c.conn.SetDeadline(time.Time{})
	}()

	c.nextID++
	req["jsonrpc"] = "2.0"
	req["id"] = c.nextID

	data, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal: %w", err)
	}
	data = append(data, '\n')

	if _, err := c.conn.Write(data); err != nil {
		return nil, fmt.Errorf("write: %w", err)
	}

	line, err := readJSONLine(c.reader, maxJSONLineBytes)
	if err != nil {
		return nil, err
	}

	var resp map[string]any
	if err := json.Unmarshal(line, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}

	if errMsg := rpcErrorMessage(resp["error"]); errMsg != "" {
		return nil, fmt.Errorf("deno: %s", errMsg)
	}
	if result, ok := resp["result"].(map[string]any); ok {
		return result, nil
	}
	return resp, nil
}

func readJSONLine(reader *bufio.Reader, maxBytes int) ([]byte, error) {
	if maxBytes <= 0 {
		maxBytes = maxJSONLineBytes
	}

	var line []byte
	for {
		chunk, err := reader.ReadSlice('\n')
		line = append(line, chunk...)
		if len(line) > maxBytes {
			return nil, fmt.Errorf("deno: response too large")
		}

		if err == nil {
			return line, nil
		}
		if errors.Is(err, bufio.ErrBufferFull) {
			continue
		}
		return nil, fmt.Errorf("read: %w", err)
	}
}

func rpcErrorMessage(value any) string {
	switch errValue := value.(type) {
	case string:
		return errValue
	case map[string]any:
		if message, ok := errValue["message"].(string); ok && message != "" {
			return message
		}
		if message, ok := errValue["error"].(string); ok && message != "" {
			return message
		}
	case nil:
		return ""
	}
	return ""
}

// Ping checks whether the Deno sidecar JSON-RPC server is responsive.
func (c *DenoClient) Ping() error {
	resp, err := c.call(map[string]any{
		"method": "Ping",
	}, denoPingTimeout)
	if err != nil {
		return err
	}
	if resp["ok"] != true {
		return fmt.Errorf("deno: ping failed")
	}
	return nil
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
	}, denoModuleLoadTimeout)
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
	}, denoModuleStopTimeout)
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

// ReloadModulesResponse holds the result of a ReloadModules call.
type ReloadModulesResponse struct {
	Ok      bool
	Results []LoadModuleResponse
}

// ModuleStatus queries the status of a module in the Deno runtime.
func (c *DenoClient) ModuleStatus(code string) (*ModuleStatusResponse, error) {
	resp, err := c.call(map[string]any{
		"method": "ModuleStatus",
		"code":   code,
	}, denoModuleStatusTimeout)
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

// ReloadModules asks Deno to reload every active module.
func (c *DenoClient) ReloadModules() (*ReloadModulesResponse, error) {
	resp, err := c.call(map[string]any{
		"method": "ReloadModules",
	}, denoModuleLoadTimeout)
	if err != nil {
		return nil, err
	}

	results := make([]LoadModuleResponse, 0)
	if rawResults, ok := resp["results"].([]any); ok {
		for _, rawResult := range rawResults {
			entry, ok := rawResult.(map[string]any)
			if !ok {
				continue
			}
			errStr, _ := entry["error"].(string)
			results = append(results, LoadModuleResponse{
				Ok:    entry["ok"] == true,
				Error: errStr,
			})
		}
	}

	return &ReloadModulesResponse{
		Ok:      resp["ok"] == true,
		Results: results,
	}, nil
}
