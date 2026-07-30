# The Java host

The same twenty-three charts as the GLFW and Qt galleries, in a window, driven from Java
through the generated Panama binding.

```bash
cmake --preset debug && cmake --build build/debug   # once, for libphoton
./hosts/java/run-gallery.sh
```

```
drag   pan          wheel   zoom about the cursor
B      box zoom     P       back to pan
R      reset view   T       light / dark
space  pause the streaming panel      Esc  quit
```

Two flags for running it without a person watching:

```bash
./hosts/java/run-gallery.sh --frames 60          # render 60 frames and exit
./hosts/java/run-gallery.sh --grab gallery.png   # write one frame and exit
```

`run-gallery.sh` fetches LWJGL from Maven Central into `build/java-deps` on the
first run and reuses it afterwards — the same choice the GLFW host makes about
GLFW, for the same reason: nothing else here needs anything installed, and a
demo should not be why someone has to set up a package manager. Needs a JDK 22+,
which is when the foreign function API became final.

It will not use an ASan build of the library. The JVM is uninstrumented and
`dlopen`s the library, which puts ASan's runtime after the JVM's in the initial
library list, and ASan refuses to run at all in that arrangement. The script
picks a release or debug build; `PHOTON_LIBRARY` overrides it.

## Why LWJGL

A chart needs a GL context and the JDK has no way to make one. LWJGL's GLFW
bindings are the standard answer, and they are all that is needed: Photon
resolves its own GL entry points, so `lwjgl-opengl` is not on the classpath.

The host does not clear the framebuffer either — it has no GL call of its own at
all. Instead each plot sets `ph_plot_desc.border`, which fills its whole cell
including the margins, so every frame fully repaints. That is a legitimate use
of the field rather than a trick, and it keeps the dependency list at two jars.

## The upcall

`ph_host_desc.get_proc_address` is the only callback in the ABI. Everything else
is polled precisely so that a managed runtime never has to hand a function
pointer across a boundary — but GL entry points can only be resolved by whoever
owns the context, so this one is unavoidable.

```java
private static MemorySegment resolveGl(MemorySegment name, MemorySegment user) {
    String symbol = name.reinterpret(Long.MAX_VALUE).getString(0);
    long address = GLFW.glfwGetProcAddress(symbol);
    return address == 0L ? MemorySegment.NULL : MemorySegment.ofAddress(address);
}
```

Two things about that are easy to get wrong. The `reinterpret` is mandatory: a
raw upcall parameter arrives with length zero, because the JVM has no idea how
big the thing behind the pointer is, and `getString` refuses to read from it
until told. And the stub has to be allocated in an arena that outlives the
library's use of it — `Arena.global()` here, since `ph_init` keeps the pointer
for the process's lifetime.

## What this host verifies

That the engine draws the same chart in every language. Not as a claim: the
GLFW gallery and this one were rendered at the same size, composited the same
way, and compared pixel by pixel.

```
C vs Java: 0 pixels of 1075200 differ by more than 2 levels, worst delta 2
```

The remaining two levels are rounding in the comparison's own alpha
compositing, not in either renderer. The scatter panel uses a fixed LCG rather
than a random source precisely so that this comparison means something.

## Known gaps

- The charts are built in Java rather than shared from `hosts/common/panels.c`,
  because those panels are ordinary C and not part of the ABI. So they are a
  transcription, and the pixel comparison above is what keeps them honest.
- No idiomatic wrapper. The gallery calls the generated binding directly, which
  is verbose — `desc.set(ValueLayout.ADDRESS, ph_line_desc.OFFSET_X, xs)` where
  a wrapper would say `line.x(xs)`. That wrapper belongs above the binding and
  has not been written.
- Not run by `ctest`. It needs a display; `bindings/java/PhotonSmokeTest.java` is
  the headless one that is.
