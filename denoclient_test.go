package ts

import (
	"bufio"
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
