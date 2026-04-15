package ts

import (
	"context"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestExecProcessRunner_Good(t *testing.T) {
	runner := newExecProcessRunner()
	require.NotNil(t, runner)

	handle, err := runner.Start(context.Background(), "sleep", "5")
	require.NoError(t, err)
	require.NotNil(t, handle)
	assert.NotEmpty(t, handle.Info().ID)

	require.NoError(t, runner.Kill(handle.Info().ID))
}
