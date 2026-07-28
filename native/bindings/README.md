# Binding sketches

Reference only — these are **not built** by CMake and are not complete bindings.

They exist because Faz 0's job is to prove the ABI is bindable before anything
is built on top of it. Each sketch covers the same slice — init, create a plot,
add a line, feed input, render, poll events, destroy — which is enough to
exercise every marshalling shape the ABI uses: handles, descriptor structs,
array arguments, UTF-8 strings, and out-parameters.

The real bindings land in Faz 3 and should be **generated from
`include/photon/photon.h`**, not hand-written. Four hand-maintained copies of 48
signatures is four places for a struct field to drift out of order, and a struct
field in the wrong order is a silent data corruption rather than a compile error.

| File | Host | Mechanism |
| --- | --- | --- |
| `csharp/PhotonNative.cs` | Avalonia, WPF, WinUI | P/Invoke, `CallingConvention.Cdecl` |
| `java/PhotonNative.java` | LWJGL, JavaFX | Panama FFM (JDK 22+) |

Qt/QML needs no binding layer — it is C++ and includes `photon.h` directly.
