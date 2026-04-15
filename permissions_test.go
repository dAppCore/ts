package ts

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestCheckPath_Good_Allowed(t *testing.T) {
	allowed := []string{"./data/", "./config/"}
	assert.True(t, CheckPath("./data/file.txt", allowed))
	assert.True(t, CheckPath("./config/app.json", allowed))
}

func TestCheckPath_Bad_Denied(t *testing.T) {
	allowed := []string{"./data/"}
	assert.False(t, CheckPath("./secrets/key.pem", allowed))
	assert.False(t, CheckPath("../escape/file", allowed))
}

func TestCheckPath_Bad_PrefixBoundary(t *testing.T) {
	allowed := []string{"./data/"}
	assert.False(t, CheckPath("./data-secrets/key.pem", allowed))
}

func TestCheckPath_Good_EmptyDenyAll(t *testing.T) {
	assert.False(t, CheckPath("./anything", nil))
	assert.False(t, CheckPath("./anything", []string{}))
}

func TestCheckPath_Good_RootGrant(t *testing.T) {
	allowed := []string{"./"}

	assert.True(t, CheckPath("./data/file.txt", allowed))
	assert.True(t, CheckPath("data/file.txt", allowed))
	assert.True(t, CheckPath(".", allowed))
	assert.False(t, CheckPath("../escape/file", allowed))
}

func TestCheckPath_Bad_RootGrantAbsolutePath(t *testing.T) {
	allowed := []string{"./"}

	assert.False(t, CheckPath("/etc/passwd", allowed))
}

func TestCheckNet_Good_Allowed(t *testing.T) {
	allowed := []string{"pool.lthn.io:3333", "api.lthn.io:443"}
	assert.True(t, CheckNet("pool.lthn.io:3333", allowed))
}

func TestCheckNet_Bad_Denied(t *testing.T) {
	allowed := []string{"pool.lthn.io:3333"}
	assert.False(t, CheckNet("evil.com:80", allowed))
}

func TestCheckRun_Good(t *testing.T) {
	allowed := []string{"xmrig", "sha256sum"}
	assert.True(t, CheckRun("xmrig", allowed))
	assert.False(t, CheckRun("rm", allowed))
}
