package ts

import (
	"bufio"
	"net"
	"testing"

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

	_, err := client.call(map[string]any{"method": "Ping"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "client closed")
}
