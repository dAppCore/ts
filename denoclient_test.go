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
