package ts

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// ensureSecureSocketDir rejects symlinked socket directories and non-directory
// path components before a Unix socket is created underneath them.
func ensureSecureSocketDir(dir string) error {
	clean := filepath.Clean(dir)
	switch clean {
	case ".", string(filepath.Separator):
		return nil
	}

	parent := filepath.Dir(clean)
	if parent != clean {
		if err := ensureSecureSocketDir(parent); err != nil {
			return err
		}
	}

	info, err := os.Lstat(clean)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("lstat %s: %w", clean, err)
	}
	if info.Mode()&os.ModeSymlink != 0 {
		if filepath.Dir(clean) == string(filepath.Separator) {
			return nil
		}
		return fmt.Errorf("socket directory %s is a symlink", clean)
	}
	if !info.IsDir() {
		return fmt.Errorf("socket directory %s exists and is not a directory", clean)
	}
	return nil
}
