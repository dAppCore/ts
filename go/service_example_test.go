package ts

func ExampleNewServiceFactory() {
	_ = NewServiceFactory
}

func ExampleService_OnStartup() {
	_ = (*Service).OnStartup
}

func ExampleService_OnShutdown() {
	_ = (*Service).OnShutdown
}

func ExampleService_Sidecar() {
	_ = (*Service).Sidecar
}

func ExampleService_GRPCServer() {
	_ = (*Service).GRPCServer
}

func ExampleService_DenoClient() {
	_ = (*Service).DenoClient
}

func ExampleService_Installer() {
	_ = (*Service).Installer
}

func ExampleService_LoadModule() {
	_ = (*Service).LoadModule
}

func ExampleService_UnloadModule() {
	_ = (*Service).UnloadModule
}

func ExampleService_ModuleStatus() {
	_ = (*Service).ModuleStatus
}

func ExampleService_ReloadModules() {
	_ = (*Service).ReloadModules
}
