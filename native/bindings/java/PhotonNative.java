// Faz 0 binding sketch — reference, not a shipping binding. See ../README.md.
//
// Panama (the Foreign Function & Memory API, final in JDK 22) rather than JNI.
// JNI would mean a second native artifact to build and ship per platform, and a
// hand-written shim per function; Panama calls the C ABI directly, which is the
// reason the ABI was kept to plain C in the first place.

package photon.native_;

import java.lang.foreign.Arena;
import java.lang.foreign.FunctionDescriptor;
import java.lang.foreign.Linker;
import java.lang.foreign.MemoryLayout;
import java.lang.foreign.MemorySegment;
import java.lang.foreign.SymbolLookup;
import java.lang.foreign.ValueLayout;
import java.lang.invoke.MethodHandle;
import java.lang.invoke.VarHandle;

public final class PhotonNative {
    public static final int ABI_VERSION = 1;

    public static final int PH_OK = 0;
    public static final int PH_E_INVALID_HANDLE = -1;
    public static final int PH_E_INVALID_ARGUMENT = -2;
    public static final int PH_E_UNSUPPORTED = -4;
    public static final int PH_E_WRONG_THREAD = -8;

    public static final int PH_EVENT_NONE = 0;
    public static final int PH_EVENT_VIEW_CHANGED = 1;
    public static final int PH_EVENT_CURSOR_MOVED = 2;
    public static final int PH_EVENT_REDRAW_REQUESTED = 5;

    private static final Linker LINKER = Linker.nativeLinker();
    // System.loadLibrary maps "photon" to libphoton.so / libphoton.dylib /
    // photon.dll, which is why the CMake build keeps that name on all three.
    private static final SymbolLookup LOOKUP = SymbolLookup.libraryLookup(
            System.mapLibraryName("photon"), Arena.global());

    private static final ValueLayout.OfInt    I32 = ValueLayout.JAVA_INT;
    private static final ValueLayout.OfLong   U64 = ValueLayout.JAVA_LONG;
    private static final ValueLayout.OfDouble F64 = ValueLayout.JAVA_DOUBLE;
    private static final ValueLayout.OfFloat  F32 = ValueLayout.JAVA_FLOAT;
    private static final MemoryLayout ADDR = ValueLayout.ADDRESS;

    // ph_range { double lo; double hi; }
    public static final MemoryLayout PH_RANGE = MemoryLayout.structLayout(
            F64.withName("lo"), F64.withName("hi")).withName("ph_range");

    // ph_event — flat and union-free precisely so this layout is mechanical.
    public static final MemoryLayout PH_EVENT = MemoryLayout.structLayout(
            I32.withName("struct_size"),
            I32.withName("type"),
            U64.withName("layer"),
            PH_RANGE.withName("x"),
            PH_RANGE.withName("y"),
            F64.withName("cursor_x"),
            F64.withName("cursor_y"),
            I32.withName("cursor_valid"),
            I32.withName("mode"),
            I32.withName("visible"),
            // The C compiler pads the struct to its 8-byte alignment; Panama
            // does not add that for us, so it is spelled out.
            MemoryLayout.paddingLayout(4)
    ).withName("ph_event");

    public static final MemoryLayout PH_FRAME_TARGET = MemoryLayout.structLayout(
            I32.withName("struct_size"),
            I32.withName("framebuffer"),
            I32.withName("x"), I32.withName("y"),
            I32.withName("width"), I32.withName("height"),
            F32.withName("dpr"),
            I32.withName("flip_y")
    ).withName("ph_frame_target");

    private static final VarHandle EVENT_TYPE =
            PH_EVENT.varHandle(MemoryLayout.PathElement.groupElement("type"));

    private static MethodHandle downcall(String name, FunctionDescriptor descriptor) {
        return LINKER.downcallHandle(
                LOOKUP.find(name).orElseThrow(() -> new UnsatisfiedLinkError(name)),
                descriptor);
    }

    private static final MethodHandle PH_INIT =
            downcall("ph_init", FunctionDescriptor.of(I32, I32, ADDR));
    private static final MethodHandle PH_SHUTDOWN =
            downcall("ph_shutdown", FunctionDescriptor.ofVoid());
    private static final MethodHandle PH_PLOT_CREATE =
            downcall("ph_plot_create", FunctionDescriptor.of(I32, ADDR, ADDR));
    private static final MethodHandle PH_PLOT_DESTROY =
            downcall("ph_plot_destroy", FunctionDescriptor.of(I32, U64));
    private static final MethodHandle PH_PLOT_ADD_LINE =
            downcall("ph_plot_add_line", FunctionDescriptor.of(I32, U64, ADDR, ADDR));
    private static final MethodHandle PH_LINE_DESC_INIT =
            downcall("ph_line_desc_init", FunctionDescriptor.ofVoid(ADDR));
    private static final MethodHandle PH_PLOT_WHEEL =
            downcall("ph_plot_wheel", FunctionDescriptor.of(I32, U64, F64, F64, F64, I32));
    private static final MethodHandle PH_PLOT_RENDER =
            downcall("ph_plot_render", FunctionDescriptor.of(I32, U64, ADDR));
    private static final MethodHandle PH_PLOT_POLL_EVENT =
            downcall("ph_plot_poll_event", FunctionDescriptor.of(I32, U64, ADDR));
    private static final MethodHandle PH_LAST_ERROR =
            downcall("ph_last_error", FunctionDescriptor.of(ADDR));

    private PhotonNative() {}

    public static int init() {
        try {
            return (int) PH_INIT.invokeExact(ABI_VERSION, MemorySegment.NULL);
        } catch (Throwable t) {
            throw new AssertionError(t);
        }
    }

    public static void shutdown() {
        try {
            PH_SHUTDOWN.invokeExact();
        } catch (Throwable t) {
            throw new AssertionError(t);
        }
    }

    public static String lastError() {
        try {
            MemorySegment p = (MemorySegment) PH_LAST_ERROR.invokeExact();
            // The pointer is thread-local and owned by the library — read it now.
            return p.equals(MemorySegment.NULL) ? "" : p.reinterpret(Long.MAX_VALUE).getString(0);
        } catch (Throwable t) {
            throw new AssertionError(t);
        }
    }

    /** Creates an all-defaults plot. Returns the handle, or throws with the ABI's message. */
    public static long createPlot(Arena arena) {
        MemorySegment out = arena.allocate(U64);
        try {
            int r = (int) PH_PLOT_CREATE.invokeExact(MemorySegment.NULL, out);
            if (r != PH_OK) throw new IllegalStateException(lastError());
            return out.get(U64, 0);
        } catch (Throwable t) {
            throw new AssertionError(t);
        }
    }

    public static int destroyPlot(long plot) {
        try {
            return (int) PH_PLOT_DESTROY.invokeExact(plot);
        } catch (Throwable t) {
            throw new AssertionError(t);
        }
    }

    public static int wheel(long plot, double px, double py, double deltaY) {
        try {
            return (int) PH_PLOT_WHEEL.invokeExact(plot, px, py, deltaY, 0);
        } catch (Throwable t) {
            throw new AssertionError(t);
        }
    }

    public static int render(long plot, MemorySegment frameTarget) {
        try {
            return (int) PH_PLOT_RENDER.invokeExact(plot, frameTarget);
        } catch (Throwable t) {
            throw new AssertionError(t);
        }
    }

    /**
     * Drains the event queue. Call once per frame.
     *
     * A polled queue is why this method exists at all: an upcall from native
     * code into a JVM callback would need a bound method handle kept alive
     * across the boundary, and would run on whatever thread the renderer
     * happens to be on.
     */
    public static void drainEvents(Arena arena, long plot, java.util.function.IntConsumer onEvent) {
        MemorySegment ev = arena.allocate(PH_EVENT);
        try {
            while (true) {
                int r = (int) PH_PLOT_POLL_EVENT.invokeExact(plot, ev);
                if (r != PH_OK) return;
                int type = (int) EVENT_TYPE.get(ev, 0L);
                if (type == PH_EVENT_NONE) return;
                onEvent.accept(type);
            }
        } catch (Throwable t) {
            throw new AssertionError(t);
        }
    }

    /**
     * Adds a line series.
     *
     * The x/y arrays are copied inside the call, so this confined Arena can be
     * closed the moment it returns — no long-lived off-heap buffer to track and
     * no interaction with GC movement.
     */
    public static long addLine(long plot, double[] xs, double[] ys, int color) {
        if (xs.length != ys.length) throw new IllegalArgumentException("x and y must be the same length");
        try (Arena arena = Arena.ofConfined()) {
            MemorySegment x = arena.allocateFrom(F64, xs);
            MemorySegment y = arena.allocateFrom(F64, ys);

            // ph_line_desc: let the library fill the defaults, then overwrite
            // the fields we care about. Field offsets come from the header; in
            // Faz 3 this struct is generated, not typed out.
            MemorySegment desc = arena.allocate(128, 8);
            PH_LINE_DESC_INIT.invokeExact(desc);
            desc.set(ADDR, 8, x);
            desc.set(ADDR, 16, y);
            desc.set(I32, 24, xs.length);
            desc.set(I32, 28, color);

            MemorySegment out = arena.allocate(U64);
            int r = (int) PH_PLOT_ADD_LINE.invokeExact(plot, desc, out);
            if (r != PH_OK) throw new IllegalStateException(lastError());
            return out.get(U64, 0);
        } catch (Throwable t) {
            throw new AssertionError(t);
        }
    }
}
