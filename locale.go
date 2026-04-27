package ts

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	pb "dappco.re/go/core/ts/proto"
)

// LocaleGet implements CoreService.LocaleGet by discovering shared locale files
// under .core/locales and returning the first JSON payload that exists.
func (s *Server) LocaleGet(_ context.Context, req *pb.LocaleGetRequest) (*pb.LocaleGetResponse, error) {
	locale := strings.TrimSpace(req.Locale)
	if locale == "" {
		return &pb.LocaleGetResponse{Found: false}, nil
	}

	for _, path := range localeCandidates(locale) {
		if !s.medium.Exists(path) {
			continue
		}

		content, err := s.medium.Read(path)
		if err != nil {
			return nil, fmt.Errorf("read locale %s: %w", path, err)
		}

		return &pb.LocaleGetResponse{Found: true, Content: content}, nil
	}

	return &pb.LocaleGetResponse{Found: false}, nil
}

func localeCandidates(locale string) []string {
	root := filepath.Join(".core", "locales")
	seen := make(map[string]struct{})
	var candidates []string

	add := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		if _, ok := seen[value]; ok {
			return
		}
		seen[value] = struct{}{}
		candidates = append(candidates, value)
	}

	normalized := strings.ReplaceAll(locale, "_", "-")
	lower := strings.ToLower(normalized)
	base := normalized
	if idx := strings.Index(normalized, "-"); idx > 0 {
		base = normalized[:idx]
	}

	for _, variant := range []string{locale, normalized, lower, base, strings.ToLower(base)} {
		add(filepath.Join(root, variant+".json"))
		add(filepath.Join(root, variant, "index.json"))
	}

	return candidates
}
