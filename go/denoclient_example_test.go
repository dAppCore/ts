package ts

func ExampleDialDeno() {
	_ = DialDeno
}

func ExampleDenoClient_Close() {
	_ = (*DenoClient).Close
}

func ExampleDenoClient_Ping() {
	_ = (*DenoClient).Ping
}

func ExampleDenoClient_LoadModule() {
	_ = (*DenoClient).LoadModule
}

func ExampleDenoClient_UnloadModule() {
	_ = (*DenoClient).UnloadModule
}

func ExampleDenoClient_ModuleStatus() {
	_ = (*DenoClient).ModuleStatus
}

func ExampleDenoClient_ReloadModules() {
	_ = (*DenoClient).ReloadModules
}
