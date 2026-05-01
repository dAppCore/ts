package ts

func ExampleSidecar_Start() {
	_ = (*Sidecar).Start
}

func ExampleSidecar_Stop() {
	_ = (*Sidecar).Stop
}

func ExampleSidecar_IsRunning() {
	_ = (*Sidecar).IsRunning
}

func ExampleSidecar_ExitError() {
	_ = (*Sidecar).ExitError
}
