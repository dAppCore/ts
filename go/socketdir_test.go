package ts

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSocketDir_ensureSecureSocketDir_Good_NestedPath(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "core", "socket")

	require.NoError(t, ensureSecureSocketDir(dir))
}

func TestSocketDir_ensureSecureSocketDir_Bad_NonDirectory(t *testing.T) {
	baseDir := t.TempDir()
	blocker := filepath.Join(baseDir, "blocked")
	require.NoError(t, os.WriteFile(blocker, []byte("file"), 0644))

	err := ensureSecureSocketDir(filepath.Join(blocker, "core.sock"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not a directory")
}

func TestSocketDir_ensureSecureSocketDir_Ugly_SymlinkComponent(t *testing.T) {
	baseDir := t.TempDir()
	targetDir := filepath.Join(baseDir, "target")
	linkDir := filepath.Join(baseDir, "link")
	require.NoError(t, os.MkdirAll(targetDir, 0755))
	if err := os.Symlink(targetDir, linkDir); err != nil {
		t.Skipf("symlinks are not available: %v", err)
	}

	err := ensureSecureSocketDir(filepath.Join(linkDir, "core.sock"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "symlink")
}
