package ts

import (
	"path/filepath"
	"slices"
	"strings"
)

// CheckPath returns true if the given path is under any of the allowed prefixes.
// Empty allowed list means deny all (secure by default).
func CheckPath(path string, allowed []string) bool {
	if len(allowed) == 0 {
		return false
	}
	clean := filepath.Clean(path)
	for _, prefix := range allowed {
		cleanPrefix := filepath.Clean(prefix)
		// Exact match or path is under the prefix directory.
		// The separator check prevents "data" matching "data-secrets".
		if clean == cleanPrefix || strings.HasPrefix(clean, cleanPrefix+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

// CheckNet returns true if the given host:port is in the allowed list.
func CheckNet(addr string, allowed []string) bool {
	return slices.Contains(allowed, addr)
}

// CheckRun returns true if the given command is in the allowed list.
func CheckRun(cmd string, allowed []string) bool {
	return slices.Contains(allowed, cmd)
}
