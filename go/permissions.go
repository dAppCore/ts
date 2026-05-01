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
		if prefixAllowsPath(clean, cleanPrefix) {
			return true
		}
	}
	return false
}

func prefixAllowsPath(clean, cleanPrefix string) bool {
	switch cleanPrefix {
	case ".":
		// A root-prefix grant ("." or "./") means the path must stay inside the
		// sandbox root. filepath.Clean preserves leading ".." segments, which lets
		// us reject directory traversal whilst still allowing ordinary relative
		// paths under the application root.
		if clean == "." || clean == "" {
			return true
		}
		if filepath.IsAbs(clean) {
			return false
		}
		return clean != ".." && !strings.HasPrefix(clean, ".."+string(filepath.Separator))
	default:
		// Exact match or path is under the prefix directory.
		// The separator check prevents "data" matching "data-secrets".
		return clean == cleanPrefix ||
			strings.HasPrefix(clean, cleanPrefix+string(filepath.Separator))
	}
}

// CheckNet returns true if the given host:port is in the allowed list.
func CheckNet(addr string, allowed []string) bool {
	return slices.Contains(allowed, addr)
}

// CheckRun returns true if the given command is in the allowed list.
func CheckRun(cmd string, allowed []string) bool {
	return slices.Contains(allowed, cmd)
}
