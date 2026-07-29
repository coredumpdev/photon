# Bindings

Generated, not hand-written. `tools/generate_bindings.py` reads
`include/photon/photon.h` and emits everything here.

| File | What it is |
| --- | --- |
| `csharp/Photon.g.cs` | generated: P/Invoke structs, constants, all 52 entry points |
| `java/photon/Photon.java` | generated: Panama FFM layouts, method handles, all 52 entry points |
| `csharp/PhotonSmokeTest.cs` | hand-written: calls every entry point once |
| `java/PhotonSmokeTest.java` | the same test, in Java |

```bash
python3 tools/generate_bindings.py          # regenerate
python3 tools/generate_bindings.py --check  # fail if the committed files are stale
```

Qt/QML needs no binding layer — it is C++ and includes `photon.h` directly.

## Why generated

Four hand-maintained copies of fifty-two signatures is four places for a struct
field to drift out of order — and a field in the wrong order is not a compile
error in C#, in Java, or anywhere else. It is a plausible-looking number read
from the wrong offset.

Faz 0 shipped hand-written sketches instead, deliberately, to prove the ABI was
bindable at all. By the time Faz 3 came round they were already missing the four
entry points Faz 1 had added, which is that argument made concretely.

The generator computes its own field offsets from its own model of the C type
system, and that model could be wrong. So it emits a third file,
`tests/abi_layout_test.c`, which asserts every offset it computed against what
the compiler actually does, and which is built as part of the test suite. A
wrong model is a failed build here rather than a corrupted descriptor in a host
six months from now.

## Java

Built and run by `ctest` wherever a JDK 22+ is present — that is when the
foreign function API became final. It appears as `java_binding` in the test list.

```bash
javac -d out bindings/java/photon/Photon.java bindings/java/PhotonSmokeTest.java
java --enable-native-access=ALL-UNNAMED \
     -Dphoton.library=build/debug/lib/libphoton.so -cp out PhotonSmokeTest
```

Without `-Dphoton.library` it looks for `libphoton.so` / `photon.dll` /
`libphoton.dylib` on the usual library path.

Handles are plain `long`s and descriptors are `MemorySegment`s. Every struct has
a `LAYOUT`, a `SIZE`, an `OFFSET_*` per field and an `allocate(Arena)` that
zero-fills — which the ABI defines as "all defaults", so an allocated descriptor
is already a valid one.

## C#

**Not compiled or run anywhere yet.** There is no .NET SDK on the machine this
was generated on, so unlike the Java side — which `ctest` builds and runs — the
C# has only been generated. Run the smoke test first, on whatever machine you
intend to use it on:

```bash
dotnet run --project bindings/csharp
```

It needs `photon.dll` (or `libphoton.so`) beside the executable or on the
library path, and it should print `52 of 52 entry points exercised`.

Two things the generated code does deliberately:

- **`CallingConvention.Cdecl` on every import.** Not optional: .NET defaults to
  StdCall on 32-bit Windows, and the library is cdecl everywhere.
- **Two overloads for descriptor parameters.** `ph_plot_create(IntPtr, out ulong)`
  for passing NULL — which almost every descriptor accepts, meaning "defaults" —
  and `ph_plot_create(in ph_plot_desc, out ulong)` for the usual case.

Arrays marshal as `double[]` / `float[]` / `byte[]` and are copied by the library
during the call, so nothing needs to stay pinned afterwards.

### Avalonia

Not written here, because it cannot be tested here. The shape it wants:

- Subclass `OpenGlControlBase`. `OnOpenGlInit(GlInterface gl)` is where `ph_init`
  goes, with a `ph_proc_address_fn` that forwards to `gl.GetProcAddress`.
- `OnOpenGlRender(GlInterface gl, int fb)` hands over the framebuffer for
  `ph_frame_target.framebuffer`; `flip_y` stays 0.
- Avalonia renders on its own render thread, so create the plot there — inside
  `OnOpenGlInit` — not in the control's constructor. `ph_plot_render` returns
  `PH_E_WRONG_THREAD` from anywhere else.
- Input arrives on the UI thread and has to cross to the render thread. Qt Quick
  has `synchronize()` for exactly that; Avalonia does not, so the equivalent is
  a queue drained at the top of `OnOpenGlRender`. `hosts/qt/README.md` is the
  worked example of the whole problem.

### WPF

No GL interop at all: `ph_plot_render_pixels` into a `WriteableBitmap`. Rows come
back top-first, RGBA8, premultiplied.

## What is still missing

- No idiomatic wrapper over either binding. Both are faithful mirrors of the C
  names on purpose — a second naming system is a second thing to be wrong about
  — and something pleasant belongs *above* them rather than instead of them.
- No JavaFX or WPF sample. Both would drive `ph_plot_render_pixels`; neither has
  been written.
- The generator assumes a 64-bit target. A 32-bit build would need its own pair,
  and `tests/abi_layout_test.c` skips rather than asserting something false.
