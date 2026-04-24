package ts

import (
	"context"
	"errors"
	"testing"

	io "dappco.re/go/io"
	"dappco.re/go/io/store"
	pb "dappco.re/go/ts/proto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type localeErrorMedium struct {
	*io.MockMedium
	readErr string
	path    string
}

func (m *localeErrorMedium) Read(path string) (string, error) {
	if path == m.path {
		return "", errors.New(m.readErr)
	}
	return m.MockMedium.Read(path)
}

func TestLocaleGet_Good_PrefersExactMatch(t *testing.T) {
	medium := io.NewMockMedium()
	medium.Files[".core/locales/en_US.json"] = `{"name":"exact"}`
	medium.Files[".core/locales/en/index.json"] = `{"name":"fallback"}`

	st, err := store.New(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { st.Close() })

	srv := NewServer(medium, st)
	resp, err := srv.LocaleGet(context.Background(), &pb.LocaleGetRequest{Locale: "en_US"})
	require.NoError(t, err)
	require.True(t, resp.Found)
	assert.Equal(t, `{"name":"exact"}`, resp.Content)
}

func TestLocaleGet_Good_FallsBackToIndex(t *testing.T) {
	medium := io.NewMockMedium()
	medium.Files[".core/locales/en/index.json"] = `{"name":"fallback"}`

	st, err := store.New(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { st.Close() })

	srv := NewServer(medium, st)
	resp, err := srv.LocaleGet(context.Background(), &pb.LocaleGetRequest{Locale: "en"})
	require.NoError(t, err)
	require.True(t, resp.Found)
	assert.Equal(t, `{"name":"fallback"}`, resp.Content)
}

func TestLocaleGet_Bad_ReadError(t *testing.T) {
	medium := &localeErrorMedium{
		MockMedium: io.NewMockMedium(),
		readErr:    "locale disk error",
		path:       ".core/locales/en.json",
	}
	medium.Files[medium.path] = `{"name":"broken"}`

	st, err := store.New(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { st.Close() })

	srv := NewServer(medium, st)
	resp, err := srv.LocaleGet(context.Background(), &pb.LocaleGetRequest{Locale: "en"})
	require.Error(t, err)
	assert.Nil(t, resp)
	assert.Contains(t, err.Error(), "read locale .core/locales/en.json")
	assert.Contains(t, err.Error(), "locale disk error")
}

func TestLocaleGet_Ugly_BlankLocale(t *testing.T) {
	medium := io.NewMockMedium()
	st, err := store.New(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { st.Close() })

	srv := NewServer(medium, st)
	resp, err := srv.LocaleGet(context.Background(), &pb.LocaleGetRequest{Locale: "   "})
	require.NoError(t, err)
	assert.False(t, resp.Found)
}

func TestLocaleCandidates_Good_NormalisesAndDedupes(t *testing.T) {
	assert.Equal(t, []string{
		".core/locales/en_US.json",
		".core/locales/en_US/index.json",
		".core/locales/en-US.json",
		".core/locales/en-US/index.json",
		".core/locales/en-us.json",
		".core/locales/en-us/index.json",
		".core/locales/en.json",
		".core/locales/en/index.json",
	}, localeCandidates("en_US"))
}

func TestLocaleCandidates_Bad_EmptyInput(t *testing.T) {
	assert.Equal(t, []string{".core/locales/.json", ".core/locales/index.json"}, localeCandidates(""))
	assert.Equal(t, []string{".core/locales/   .json", ".core/locales/   /index.json"}, localeCandidates("   "))
}

func TestLocaleCandidates_Ugly_PathLikeInput(t *testing.T) {
	assert.Equal(t, []string{
		".core/locales/pt-BR.json",
		".core/locales/pt-BR/index.json",
		".core/locales/pt-br.json",
		".core/locales/pt-br/index.json",
		".core/locales/pt.json",
		".core/locales/pt/index.json",
	}, localeCandidates("pt-BR"))
}
