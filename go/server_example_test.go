package ts

func ExampleNewServer() {
	_ = NewServer
}

func ExampleServer_RegisterModule() {
	_ = (*Server).RegisterModule
}

func ExampleServer_UnregisterModule() {
	_ = (*Server).UnregisterModule
}

func ExampleServer_Ping() {
	_ = (*Server).Ping
}

func ExampleServer_FileRead() {
	_ = (*Server).FileRead
}

func ExampleServer_FileWrite() {
	_ = (*Server).FileWrite
}

func ExampleServer_FileList() {
	_ = (*Server).FileList
}

func ExampleServer_FileDelete() {
	_ = (*Server).FileDelete
}

func ExampleServer_StoreGet() {
	_ = (*Server).StoreGet
}

func ExampleServer_StoreSet() {
	_ = (*Server).StoreSet
}

func ExampleServer_SetProcessRunner() {
	_ = (*Server).SetProcessRunner
}

func ExampleServer_ProcessStart() {
	_ = (*Server).ProcessStart
}

func ExampleServer_ProcessStop() {
	_ = (*Server).ProcessStop
}
