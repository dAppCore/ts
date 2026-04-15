package ts

import (
	"bufio"
	"encoding/json"
	"net"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func scriptJSONRPC(t *testing.T, conn net.Conn, verify func(map[string]any), response map[string]any) {
	t.Helper()

	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
		reader := bufio.NewReader(conn)
		line, err := reader.ReadBytes('\n')
		require.NoError(t, err)

		var req map[string]any
		require.NoError(t, json.Unmarshal(line, &req))
		verify(req)

		data, err := json.Marshal(response)
		require.NoError(t, err)
		_, err = conn.Write(append(data, '\n'))
		require.NoError(t, err)
	}()

	t.Cleanup(func() {
		<-done
	})
}

func TestDenoClient_Close_Good_Idempotent(t *testing.T) {
	left, right := net.Pipe()
	defer right.Close()

	client := &DenoClient{
		conn:   left,
		reader: bufio.NewReader(left),
	}

	require.NoError(t, client.Close())
	require.NoError(t, client.Close())
	assert.Nil(t, client.conn)
	assert.Nil(t, client.reader)
}

func TestDenoClient_Call_Bad_ClosedClient(t *testing.T) {
	client := &DenoClient{}

	_, err := client.call(map[string]any{"method": "Ping"}, time.Second)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "client closed")
}

func TestDenoClient_Call_Bad_DeadlineExceeded(t *testing.T) {
	left, right := net.Pipe()
	defer right.Close()

	client := &DenoClient{
		conn:   left,
		reader: bufio.NewReader(left),
	}

	_, err := client.call(map[string]any{"method": "Ping"}, time.Millisecond)
	require.Error(t, err)
	assert.ErrorContains(t, err, "i/o timeout")
}

func TestDenoClient_Call_Good_JSONRPCEnvelope(t *testing.T) {
	left, right := net.Pipe()
	defer right.Close()

	client := &DenoClient{
		conn:   left,
		reader: bufio.NewReader(left),
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = right.SetDeadline(time.Now().Add(2 * time.Second))
		reader := bufio.NewReader(right)
		_, _ = reader.ReadBytes('\n')
		resp := map[string]any{
			"jsonrpc": "2.0",
			"id":      1,
			"result": map[string]any{
				"ok": true,
			},
		}
		data, _ := json.Marshal(resp)
		_, _ = right.Write(append(data, '\n'))
	}()

	resp, err := client.call(map[string]any{"method": "Ping"}, time.Second)
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"ok": true}, resp)

	<-done
}

func TestDenoClient_Ping_Good(t *testing.T) {
	left, right := net.Pipe()
	defer right.Close()

	client := &DenoClient{
		conn:   left,
		reader: bufio.NewReader(left),
	}

	scriptJSONRPC(t, right, func(req map[string]any) {
		assert.Equal(t, "Ping", req["method"])
	}, map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"result": map[string]any{
			"ok": true,
		},
	})

	require.NoError(t, client.Ping())
}

func TestDenoClient_Ping_Bad_Failed(t *testing.T) {
	left, right := net.Pipe()
	defer right.Close()

	client := &DenoClient{
		conn:   left,
		reader: bufio.NewReader(left),
	}

	scriptJSONRPC(t, right, func(req map[string]any) {
		assert.Equal(t, "Ping", req["method"])
	}, map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"result": map[string]any{
			"ok": false,
		},
	})

	err := client.Ping()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "ping failed")
}

func TestDenoClient_LoadModule_Good(t *testing.T) {
	left, right := net.Pipe()
	defer right.Close()

	client := &DenoClient{
		conn:   left,
		reader: bufio.NewReader(left),
	}

	scriptJSONRPC(t, right, func(req map[string]any) {
		assert.Equal(t, "LoadModule", req["method"])
		assert.Equal(t, "mod-1", req["code"])
		assert.Equal(t, "file:///module.ts", req["entry_point"])
		perms := req["permissions"].(map[string]any)
		assert.Equal(t, []any{"./data/"}, perms["read"])
		assert.Equal(t, []any{"xmrig"}, perms["run"])
	}, map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"result": map[string]any{
			"ok": true,
		},
	})

	resp, err := client.LoadModule("mod-1", "file:///module.ts", ModulePermissions{
		Read: []string{"./data/"},
		Run:  []string{"xmrig"},
	})
	require.NoError(t, err)
	assert.True(t, resp.Ok)
	assert.Empty(t, resp.Error)
}

func TestDenoClient_LoadModule_Bad_RPCError(t *testing.T) {
	left, right := net.Pipe()
	defer right.Close()

	client := &DenoClient{
		conn:   left,
		reader: bufio.NewReader(left),
	}

	scriptJSONRPC(t, right, func(req map[string]any) {
		assert.Equal(t, "LoadModule", req["method"])
	}, map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"error": map[string]any{
			"message": "module rejected",
		},
	})

	resp, err := client.LoadModule("mod-1", "file:///module.ts", ModulePermissions{})
	require.Error(t, err)
	assert.Nil(t, resp)
	assert.Contains(t, err.Error(), "module rejected")
}

func TestDenoClient_UnloadModule_Good(t *testing.T) {
	left, right := net.Pipe()
	defer right.Close()

	client := &DenoClient{
		conn:   left,
		reader: bufio.NewReader(left),
	}

	scriptJSONRPC(t, right, func(req map[string]any) {
		assert.Equal(t, "UnloadModule", req["method"])
		assert.Equal(t, "mod-1", req["code"])
	}, map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"result": map[string]any{
			"ok": true,
		},
	})

	resp, err := client.UnloadModule("mod-1")
	require.NoError(t, err)
	assert.True(t, resp.Ok)
}

func TestDenoClient_ModuleStatus_Good(t *testing.T) {
	left, right := net.Pipe()
	defer right.Close()

	client := &DenoClient{
		conn:   left,
		reader: bufio.NewReader(left),
	}

	scriptJSONRPC(t, right, func(req map[string]any) {
		assert.Equal(t, "ModuleStatus", req["method"])
		assert.Equal(t, "mod-1", req["code"])
	}, map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"result": map[string]any{
			"code":   "mod-1",
			"status": "RUNNING",
		},
	})

	resp, err := client.ModuleStatus("mod-1")
	require.NoError(t, err)
	assert.Equal(t, "mod-1", resp.Code)
	assert.Equal(t, "RUNNING", resp.Status)
}

func TestDenoClient_Call_Bad_RPCErrorString(t *testing.T) {
	left, right := net.Pipe()
	defer right.Close()

	client := &DenoClient{
		conn:   left,
		reader: bufio.NewReader(left),
	}

	scriptJSONRPC(t, right, func(req map[string]any) {
		assert.Equal(t, "Ping", req["method"])
	}, map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"error":   "boom",
	})

	_, err := client.call(map[string]any{"method": "Ping"}, time.Second)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "deno: boom")
}

func TestDenoClient_Call_Bad_RPCErrorObject(t *testing.T) {
	left, right := net.Pipe()
	defer right.Close()

	client := &DenoClient{
		conn:   left,
		reader: bufio.NewReader(left),
	}

	scriptJSONRPC(t, right, func(req map[string]any) {
		assert.Equal(t, "Ping", req["method"])
	}, map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"error": map[string]any{
			"error": "object boom",
		},
	})

	_, err := client.call(map[string]any{"method": "Ping"}, time.Second)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "deno: object boom")
}

func TestDenoClient_Call_Good_TimeoutDefault(t *testing.T) {
	left, right := net.Pipe()
	defer right.Close()

	client := &DenoClient{
		conn:   left,
		reader: bufio.NewReader(left),
	}

	scriptJSONRPC(t, right, func(req map[string]any) {
		assert.Equal(t, "Ping", req["method"])
	}, map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"result": map[string]any{
			"ok": true,
		},
	})

	// Exercise the default timeout path when callers pass a zero duration.
	resp, err := client.call(map[string]any{"method": "Ping"}, 0)
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"ok": true}, resp)
}
