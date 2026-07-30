// The Java gallery: the same eighteen charts as the GLFW and Qt ones, in a window.
//
// This is a host, not a binding test — bindings/java/PhotonSmokeTest.java is
// that. What it adds is the part of the ABI a headless test cannot reach: a
// real GL context, and the one place the ABI calls *back* into the host.
//
// `ph_host_desc.get_proc_address` is that place, and it is the only callback in
// the whole ABI. Everything else is polled precisely so that a managed runtime
// never has to hand a function pointer across — but GL entry points have to be
// resolved by whoever owns the context, so this one is unavoidable. Panama
// makes it an upcall stub; see resolveGlStub() below, which is the interesting
// twenty lines of this file.
//
// The window comes from LWJGL's GLFW. Photon does its own GL loading, so
// lwjgl-opengl is not needed: the only GL this file touches is the context.
//
//   ./hosts/java/run-gallery.sh
//
//   drag   pan          wheel   zoom about the cursor
//   B      box zoom     P       back to pan
//   R      reset view   T       light / dark
//   space  pause the streaming panel      Esc  quit

import static photon.Photon.*;

import java.lang.foreign.Arena;
import java.lang.foreign.FunctionDescriptor;
import java.lang.foreign.Linker;
import java.lang.foreign.MemorySegment;
import java.lang.foreign.ValueLayout;
import java.lang.invoke.MethodHandle;
import java.lang.invoke.MethodHandles;
import java.lang.invoke.MethodType;
import java.awt.image.BufferedImage;
import javax.imageio.ImageIO;
import org.lwjgl.glfw.GLFW;
import org.lwjgl.glfw.GLFWErrorCallback;
import org.lwjgl.system.MemoryStack;
import photon.Photon;

public final class PhotonGallery {

    private static final int PANELS = 34;
    private static final int COLUMNS = 5;
    private static final int SAMPLES = 512;
    private static final int MONTHS = 12;
    private static final int FUNNEL_STAGES = 5;
    private static final int SCATTER_POINTS = 1500;
    private static final int STREAM_POINTS = 400;
    private static final int SLICES = 5;
    private static final int IMPULSES = 24;
    private static final int TRIALS = 14;
    private static final int BOXES = 5;
    private static final int BOX_SAMPLES = 60;
    private static final int FIELD_COLS = 96;
    private static final int FIELD_ROWS = 72;
    private static final int SPRITE = 16;
    private static final int SESSIONS = 34;
    private static final int DENSE_POINTS = 24000;
    private static final int FLOW = 14;
    private static final int ISO_LEVELS = 9;
    private static final int NODES = 48;
    private static final int GRAPH_EDGES = 72;
    private static final int BOLLINGER_PERIOD = 10;
    private static final int FIT_POINTS = 160;
    private static final int FIT_GRID = 60;
    private static final int PSD_SAMPLES = 2048;
    private static final int PSD_SEGMENT = 256;
    private static final int PSD_BINS = PSD_SEGMENT / 2;
    private static final double PSD_RATE = 256.0;
    private static final int ROC_SAMPLES = 240;
    private static final int EMBED_POINTS = 300;
    private static final int EMBED_DIMS = 4;
    private static final int TREEMAP_ITEMS = 8;
    private static final int TREE_NODES = 13;
    private static final int FLOW_NODES = 6;
    private static final int FLOW_LINKS = 6;
    private static final int CHORD_GROUPS = 4;
    private static final int PARALLEL_DIMS = 4;
    private static final int PARALLEL_ROWS = 40;
    private static final int STREAMS = 3;
    private static final int HIST_SAMPLES = 4000;
    private static final int ROSE_POINTS = 361;
    private static final int ROSE_MARKS = 12;

    /** Lives as long as the window: the streaming panel rewrites its arrays. */
    private static final Arena ARENA = Arena.ofShared();

    private static final long[] plots = new long[PANELS];
    private static long streamLayer = PH_NULL_HANDLE;
    private static long fieldLayer = PH_NULL_HANDLE;
    private static MemorySegment fieldValues;
    private static MemorySegment fieldDesc;
    private static MemorySegment streamX;
    private static MemorySegment streamY;

    private static long window;
    private static int theme = PH_THEME_DARK;
    private static boolean paused = false;
    private static double cursorX, cursorY;
    private static int hovered = -1;

    // -----------------------------------------------------------------------
    // The callback
    // -----------------------------------------------------------------------

    /**
     * What Photon calls to resolve a GL entry point.
     *
     * It runs on whichever thread is rendering, with the context current, which
     * here is the main thread. The name arrives as a NUL-terminated C string in
     * memory the library owns, so it is reinterpreted with an unbounded size
     * before being read — a raw upcall parameter has length zero until told
     * otherwise, and getString would refuse.
     */
    private static MemorySegment resolveGl(MemorySegment name, MemorySegment user) {
        String symbol = name.reinterpret(Long.MAX_VALUE).getString(0);
        long address = GLFW.glfwGetProcAddress(symbol);
        return address == 0L ? MemorySegment.NULL : MemorySegment.ofAddress(address);
    }

    private static MemorySegment resolveGlStub() throws Exception {
        MethodHandle handle = MethodHandles.lookup().findStatic(
            PhotonGallery.class, "resolveGl",
            MethodType.methodType(MemorySegment.class, MemorySegment.class, MemorySegment.class));
        return Linker.nativeLinker().upcallStub(
            handle,
            FunctionDescriptor.of(ValueLayout.ADDRESS, ValueLayout.ADDRESS, ValueLayout.ADDRESS),
            Arena.global());
    }

    // -----------------------------------------------------------------------
    // The charts — the same eighteen as hosts/common/panels.c, through the binding
    // -----------------------------------------------------------------------

    private static MemorySegment doubles(int count) {
        return ARENA.allocate(ValueLayout.JAVA_DOUBLE, count);
    }

    private static long create(String background) {
        MemorySegment desc = ph_plot_desc.allocate(ARENA);
        ph_plot_desc_init(desc);
        desc.set(ValueLayout.JAVA_INT, ph_plot_desc.OFFSET_THEME, theme);
        desc.set(ValueLayout.JAVA_INT, ph_plot_desc.OFFSET_BACKGROUND, color(background));
        // The host draws nothing of its own — no glClear, no lwjgl-opengl — so
        // the plot paints its whole cell, margins included. That is what
        // `border` is for, and it means every frame fully repaints.
        desc.set(ValueLayout.JAVA_INT, ph_plot_desc.OFFSET_BORDER, color("#0d1117"));

        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        int result = ph_plot_create(desc, out);
        if (result != PH_OK) throw new IllegalStateException(Photon.lastError());
        return out.get(ValueLayout.JAVA_LONG, 0);
    }

    private static int color(String css) {
        try (Arena scratch = Arena.ofConfined()) {
            MemorySegment out = scratch.allocate(ValueLayout.JAVA_INT);
            ph_color_parse(scratch.allocateFrom(css), out);
            return out.get(ValueLayout.JAVA_INT, 0);
        }
    }

    private static void styleAxis(long plot, String axis, String title, int minors) {
        try (Arena scratch = Arena.ofConfined()) {
            MemorySegment config = ph_axis_config.allocate(scratch);
            ph_axis_config_init(config);
            config.set(ValueLayout.ADDRESS, ph_axis_config.OFFSET_TITLE,
                       scratch.allocateFrom(title));
            config.set(ValueLayout.JAVA_INT, ph_axis_config.OFFSET_MINOR_TICKS, minors);
            ph_plot_set_axis_config(plot, scratch.allocateFrom(axis), config);
        }
    }

    private static void setTitle(long plot, String title) {
        try (Arena scratch = Arena.ofConfined()) {
            ph_plot_set_title(plot, scratch.allocateFrom(title));
        }
    }

    private static long addLine(long plot, MemorySegment xs, MemorySegment ys, int count,
                                String css, float width, MemorySegment dash, int dashCount,
                                int join) {
        return addLine(plot, xs, ys, count, css, width, dash, dashCount, join, null);
    }

    /** `name` is what puts a series in the legend; an unnamed one stays out. */
    private static long addLine(long plot, MemorySegment xs, MemorySegment ys, int count,
                                String css, float width, MemorySegment dash, int dashCount,
                                int join, String name) {
        MemorySegment desc = ph_line_desc.allocate(ARENA);
        ph_line_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_line_desc.OFFSET_X, xs);
        desc.set(ValueLayout.ADDRESS, ph_line_desc.OFFSET_Y, ys);
        desc.set(ValueLayout.JAVA_INT, ph_line_desc.OFFSET_COUNT, count);
        desc.set(ValueLayout.JAVA_INT, ph_line_desc.OFFSET_COLOR, color(css));
        desc.set(ValueLayout.JAVA_FLOAT, ph_line_desc.OFFSET_WIDTH, width);
        desc.set(ValueLayout.JAVA_INT, ph_line_desc.OFFSET_JOIN, join);
        if (name != null) {
            desc.set(ValueLayout.ADDRESS, ph_line_desc.OFFSET_NAME, ARENA.allocateFrom(name));
        }
        if (dash != null) {
            desc.set(ValueLayout.ADDRESS, ph_line_desc.OFFSET_DASH, dash);
            desc.set(ValueLayout.JAVA_INT, ph_line_desc.OFFSET_DASH_COUNT, dashCount);
        }
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_line(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
        return out.get(ValueLayout.JAVA_LONG, 0);
    }

    private static void buildWaves(long plot) {
        MemorySegment xs = doubles(SAMPLES);
        MemorySegment sine = doubles(SAMPLES);
        MemorySegment damped = doubles(SAMPLES);
        for (int i = 0; i < SAMPLES; i++) {
            double t = i * 0.05;
            xs.setAtIndex(ValueLayout.JAVA_DOUBLE, i, t);
            sine.setAtIndex(ValueLayout.JAVA_DOUBLE, i, Math.sin(t));
            damped.setAtIndex(ValueLayout.JAVA_DOUBLE, i,
                              Math.exp(-t * 0.12) * Math.cos(t * 1.6));
        }
        setTitle(plot, "Waves");
        // Two named series, so this is the panel with something to legend.
        try (Arena scratch = Arena.ofConfined()) {
            MemorySegment legend = ph_legend_config.allocate(scratch);
            ph_legend_config_init(legend);
            legend.set(ValueLayout.JAVA_INT, ph_legend_config.OFFSET_ENABLED, 1);
            legend.set(ValueLayout.JAVA_INT, ph_legend_config.OFFSET_POSITION,
                       PH_LEGEND_BOTTOM_LEFT);
            ph_plot_set_legend(plot, legend);
        }
        styleAxis(plot, "x", "time (s)", 4);
        styleAxis(plot, "y", "amplitude", 0);

        addLine(plot, xs, sine, SAMPLES, "#38bdf8", 2.0f, null, 0, PH_JOIN_ROUND, "sin t");
        MemorySegment dash = ARENA.allocate(ValueLayout.JAVA_FLOAT, 2);
        dash.setAtIndex(ValueLayout.JAVA_FLOAT, 0, 6.0f);
        dash.setAtIndex(ValueLayout.JAVA_FLOAT, 1, 4.0f);
        addLine(plot, xs, damped, SAMPLES, "#f472b6", 2.0f, dash, 2, PH_JOIN_MITER, "damped");
    }

    private static void buildDecay(long plot) {
        MemorySegment xs = doubles(SAMPLES);
        MemorySegment ys = doubles(SAMPLES);
        for (int i = 0; i < SAMPLES; i++) {
            xs.setAtIndex(ValueLayout.JAVA_DOUBLE, i, i);
            ys.setAtIndex(ValueLayout.JAVA_DOUBLE, i, 1.0e6 * Math.exp(-i * 0.022) + 1.0);
        }
        try (Arena scratch = Arena.ofConfined()) {
            MemorySegment axis = ph_axis_desc.allocate(scratch);
            ph_axis_desc_init(axis);
            axis.set(ValueLayout.JAVA_INT, ph_axis_desc.OFFSET_TYPE, PH_SCALE_LOG);
            ph_plot_set_scale(plot, scratch.allocateFrom("y"), axis);
        }
        setTitle(plot, "Log decay");
        styleAxis(plot, "x", "sample", 0);
        styleAxis(plot, "y", "counts", 0);
        addLine(plot, xs, ys, SAMPLES, "#a3e635", 2.0f, null, 0, PH_JOIN_ROUND);
    }

    private static void buildScatter(long plot) {
        MemorySegment xs = doubles(SCATTER_POINTS);
        MemorySegment ys = doubles(SCATTER_POINTS);
        MemorySegment sizes = ARENA.allocate(ValueLayout.JAVA_FLOAT, SCATTER_POINTS);
        MemorySegment colors = ARENA.allocate(ValueLayout.JAVA_INT, SCATTER_POINTS);

        // The same plain LCG the C panels use, so the picture is identical in
        // every host and on every machine — which is the point of having three.
        int seed = 12345;
        int[] palette = {0x60a5faff, 0xf59e0bff, 0x34d399ff, 0xf87171ff};
        for (int i = 0; i < SCATTER_POINTS; i++) {
            seed = seed * 1664525 + 1013904223;
            double u = ((seed >>> 8) & 0xFFFFFF) / 16777216.0;
            seed = seed * 1664525 + 1013904223;
            double v = ((seed >>> 8) & 0xFFFFFF) / 16777216.0;

            double radius = Math.sqrt(-2.0 * Math.log(u + 1e-12));
            double angle = 6.283185307179586 * v;
            double x = radius * Math.cos(angle);
            xs.setAtIndex(ValueLayout.JAVA_DOUBLE, i, x);
            ys.setAtIndex(ValueLayout.JAVA_DOUBLE, i, radius * Math.sin(angle) * 0.6 + x * 0.35);
            sizes.setAtIndex(ValueLayout.JAVA_FLOAT, i, (float) (3.0 + u * 7.0));
            colors.setAtIndex(ValueLayout.JAVA_INT, i, palette[i & 3]);
        }

        setTitle(plot, "Scatter");
        styleAxis(plot, "x", "x", 0);
        styleAxis(plot, "y", "y", 0);

        // An array of ph_tick — the ABI's answer to the web core's tick callback.
        try (Arena scratch = Arena.ofConfined()) {
            double[] values = {-3.0, -1.5, 0.0, 1.5, 3.0};
            MemorySegment ticks = scratch.allocate(ph_tick.LAYOUT, values.length);
            for (int i = 0; i < values.length; i++) {
                long base = i * ph_tick.SIZE;
                ticks.set(ValueLayout.JAVA_DOUBLE, base + ph_tick.OFFSET_VALUE, values[i]);
                ticks.set(ValueLayout.ADDRESS, base + ph_tick.OFFSET_LABEL,
                          values[i] == 0.0 ? scratch.allocateFrom("origin") : MemorySegment.NULL);
                ticks.set(ValueLayout.JAVA_INT, base + ph_tick.OFFSET_GRID, PH_TOGGLE_DEFAULT);
            }
            ph_plot_set_axis_ticks(plot, scratch.allocateFrom("x"), ticks, values.length);
        }

        MemorySegment desc = ph_scatter_desc.allocate(ARENA);
        ph_scatter_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_scatter_desc.OFFSET_X, xs);
        desc.set(ValueLayout.ADDRESS, ph_scatter_desc.OFFSET_Y, ys);
        desc.set(ValueLayout.JAVA_INT, ph_scatter_desc.OFFSET_COUNT, SCATTER_POINTS);
        desc.set(ValueLayout.ADDRESS, ph_scatter_desc.OFFSET_SIZES, sizes);
        desc.set(ValueLayout.ADDRESS, ph_scatter_desc.OFFSET_COLORS, colors);
        desc.set(ValueLayout.JAVA_INT, ph_scatter_desc.OFFSET_MARKER, PH_MARKER_CIRCLE);
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_scatter(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    private static void buildStream(long plot) {
        streamX = doubles(STREAM_POINTS);
        streamY = doubles(STREAM_POINTS);
        for (int i = 0; i < STREAM_POINTS; i++) {
            streamX.setAtIndex(ValueLayout.JAVA_DOUBLE, i, i);
        }
        setTitle(plot, "Streaming");
        styleAxis(plot, "x", "tick", 0);
        styleAxis(plot, "y", "value", 0);

        MemorySegment desc = ph_line_desc.allocate(ARENA);
        ph_line_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_line_desc.OFFSET_X, streamX);
        desc.set(ValueLayout.ADDRESS, ph_line_desc.OFFSET_Y, streamY);
        desc.set(ValueLayout.JAVA_INT, ph_line_desc.OFFSET_COUNT, STREAM_POINTS);
        desc.set(ValueLayout.JAVA_INT, ph_line_desc.OFFSET_COLOR, color("#c084fc"));
        desc.set(ValueLayout.JAVA_FLOAT, ph_line_desc.OFFSET_WIDTH, 1.5f);
        desc.set(ValueLayout.JAVA_INT, ph_line_desc.OFFSET_RENDER_TYPE, PH_RENDER_DYNAMIC);
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_line(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
        streamLayer = out.get(ValueLayout.JAVA_LONG, 0);

        try (Arena scratch = Arena.ofConfined()) {
            MemorySegment domain = ph_range.allocate(scratch);
            domain.set(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO, -2.2);
            domain.set(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI, 2.2);
            ph_plot_set_domain(plot, scratch.allocateFrom("y"), domain);
        }
    }

    /** Panel 4 — bars with a band behind them: area and bar on one plot. */
    private static void buildRevenue(long plot) {
        final double[] revenue = {42, 47, 51, 49, 58, 63, 61, 68, 72, 70, 78, 84};
        MemorySegment month = doubles(MONTHS);
        MemorySegment value = doubles(MONTHS);
        MemorySegment low = doubles(MONTHS);
        MemorySegment high = doubles(MONTHS);
        for (int i = 0; i < MONTHS; i++) {
            month.setAtIndex(ValueLayout.JAVA_DOUBLE, i, i);
            value.setAtIndex(ValueLayout.JAVA_DOUBLE, i, revenue[i]);
            low.setAtIndex(ValueLayout.JAVA_DOUBLE, i, revenue[i] * 0.82);
            high.setAtIndex(ValueLayout.JAVA_DOUBLE, i, revenue[i] * 1.14);
        }

        setTitle(plot, "Revenue");
        styleAxis(plot, "x", "month", 0);
        styleAxis(plot, "y", "k$", 0);

        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);

        // The band first, so the bars land on top of it: layers draw in the
        // order they were added, which is the only z-ordering the core has.
        MemorySegment area = ph_area_desc.allocate(ARENA);
        ph_area_desc_init(area);
        area.set(ValueLayout.ADDRESS, ph_area_desc.OFFSET_X, month);
        area.set(ValueLayout.ADDRESS, ph_area_desc.OFFSET_Y, high);
        area.set(ValueLayout.ADDRESS, ph_area_desc.OFFSET_BASE, low);
        area.set(ValueLayout.JAVA_INT, ph_area_desc.OFFSET_COUNT, MONTHS);
        area.set(ValueLayout.JAVA_INT, ph_area_desc.OFFSET_COLOR, color("#38bdf83d"));
        if (ph_plot_add_area(plot, area, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }

        MemorySegment bar = ph_bar_desc.allocate(ARENA);
        ph_bar_desc_init(bar);
        bar.set(ValueLayout.ADDRESS, ph_bar_desc.OFFSET_X, month);
        bar.set(ValueLayout.ADDRESS, ph_bar_desc.OFFSET_Y, value);
        bar.set(ValueLayout.JAVA_INT, ph_bar_desc.OFFSET_COUNT, MONTHS);
        bar.set(ValueLayout.JAVA_DOUBLE, ph_bar_desc.OFFSET_WIDTH, 0.62);
        bar.set(ValueLayout.JAVA_INT, ph_bar_desc.OFFSET_COLOR, color("#3b82f6"));
        if (ph_plot_add_bar(plot, bar, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    /** Panel 5 — five filled trapezoids, one patches layer. */
    private static void buildFunnel(long plot) {
        final double[] reach = {1.0, 0.72, 0.46, 0.28, 0.15, 0.09};
        final int[] colors = {color("#38bdf8"), color("#22d3ee"), color("#34d399"),
                              color("#a3e635"), color("#facc15")};

        setTitle(plot, "Funnel");
        styleAxis(plot, "x", "share", 0);
        styleAxis(plot, "y", "stage", 0);

        MemorySegment patches = ARENA.allocate(ph_patch.LAYOUT, FUNNEL_STAGES);
        for (int i = 0; i < FUNNEL_STAGES; i++) {
            double top = FUNNEL_STAGES - i;
            double bottom = top - 0.86;
            double halfTop = reach[i] / 2.0;
            double halfBottom = reach[i + 1] / 2.0;
            MemorySegment xs = doubles(4);
            MemorySegment ys = doubles(4);
            double[] cx = {0.5 - halfTop, 0.5 + halfTop, 0.5 + halfBottom, 0.5 - halfBottom};
            double[] cy = {top, top, bottom, bottom};
            for (int k = 0; k < 4; k++) {
                xs.setAtIndex(ValueLayout.JAVA_DOUBLE, k, cx[k]);
                ys.setAtIndex(ValueLayout.JAVA_DOUBLE, k, cy[k]);
            }
            long base = i * ph_patch.SIZE;
            patches.set(ValueLayout.ADDRESS, base + ph_patch.OFFSET_X, xs);
            patches.set(ValueLayout.ADDRESS, base + ph_patch.OFFSET_Y, ys);
            patches.set(ValueLayout.JAVA_INT, base + ph_patch.OFFSET_COUNT, 4);
            patches.set(ValueLayout.JAVA_INT, base + ph_patch.OFFSET_COLOR, colors[i]);
        }

        MemorySegment desc = ph_patches_desc.allocate(ARENA);
        ph_patches_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_patches_desc.OFFSET_PATCHES, patches);
        desc.set(ValueLayout.JAVA_INT, ph_patches_desc.OFFSET_PATCH_COUNT, FUNNEL_STAGES);
        // A choropleth: one value per patch through a ramp, which beats each
        // patch's own colour and earns the panel a colorbar.
        MemorySegment values = doubles(FUNNEL_STAGES);
        for (int i = 0; i < FUNNEL_STAGES; i++) {
            values.setAtIndex(ValueLayout.JAVA_DOUBLE, i, FUNNEL_STAGES - i);
        }
        MemorySegment ramp = ph_colormap_spec.allocate(ARENA);
        ph_colormap_spec_init(ramp);
        ramp.set(ValueLayout.ADDRESS, ph_colormap_spec.OFFSET_NAME, ARENA.allocateFrom("cividis"));
        desc.set(ValueLayout.ADDRESS, ph_patches_desc.OFFSET_VALUES, values);
        desc.set(ValueLayout.ADDRESS, ph_patches_desc.OFFSET_COLORMAP, ramp);
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_patches(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    /** Panel 6 — a donut, which is the pie layer with an inner radius. */
    private static void buildShare(long plot) {
        final double[] slices = {38.0, 24.0, 18.0, 12.0, 8.0};
        MemorySegment values = doubles(SLICES);
        for (int i = 0; i < SLICES; i++) values.setAtIndex(ValueLayout.JAVA_DOUBLE, i, slices[i]);

        setTitle(plot, "Share");
        // A pie has no axes worth reading, and the grid behind it is noise.
        try (Arena scratch = Arena.ofConfined()) {
            for (String axis : new String[] {"x", "y"}) {
                MemorySegment bare = ph_axis_config.allocate(scratch);
                ph_axis_config_init(bare);
                bare.set(ValueLayout.JAVA_INT, ph_axis_config.OFFSET_NO_AXIS_LINE, 1);
                bare.set(ValueLayout.JAVA_INT, ph_axis_config.OFFSET_NO_TICKS, 1);
                bare.set(ValueLayout.JAVA_INT, ph_axis_config.OFFSET_NO_GRID, 1);
                ph_plot_set_axis_config(plot, scratch.allocateFrom(axis), bare);
            }
        }

        MemorySegment desc = ph_pie_desc.allocate(ARENA);
        ph_pie_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_pie_desc.OFFSET_VALUES, values);
        desc.set(ValueLayout.JAVA_INT, ph_pie_desc.OFFSET_COUNT, SLICES);
        desc.set(ValueLayout.JAVA_DOUBLE, ph_pie_desc.OFFSET_RADIUS, 1.0);
        desc.set(ValueLayout.JAVA_DOUBLE, ph_pie_desc.OFFSET_INNER_RADIUS, 0.55);
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_pie(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    /** Panel 7 — stems from zero, with a disc at each tip. */
    private static void buildImpulse(long plot) {
        MemorySegment xs = doubles(IMPULSES);
        MemorySegment ys = doubles(IMPULSES);
        for (int i = 0; i < IMPULSES; i++) {
            xs.setAtIndex(ValueLayout.JAVA_DOUBLE, i, i);
            ys.setAtIndex(ValueLayout.JAVA_DOUBLE, i, Math.exp(-i * 0.12) * Math.cos(i * 0.7));
        }
        setTitle(plot, "Impulse");
        styleAxis(plot, "x", "n", 0);
        styleAxis(plot, "y", "h[n]", 0);

        MemorySegment desc = ph_stem_desc.allocate(ARENA);
        ph_stem_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_stem_desc.OFFSET_X, xs);
        desc.set(ValueLayout.ADDRESS, ph_stem_desc.OFFSET_Y, ys);
        desc.set(ValueLayout.JAVA_INT, ph_stem_desc.OFFSET_COUNT, IMPULSES);
        desc.set(ValueLayout.JAVA_INT, ph_stem_desc.OFFSET_COLOR, color("#22d3ee"));
        desc.set(ValueLayout.JAVA_FLOAT, ph_stem_desc.OFFSET_WIDTH, 2.0f);
        desc.set(ValueLayout.JAVA_FLOAT, ph_stem_desc.OFFSET_MARKER_SIZE, 7.0f);
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_stem(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    /** Panel 8 — a measured curve with its uncertainty, as a band and whiskers. */
    private static void buildYield(long plot) {
        MemorySegment xs = doubles(TRIALS);
        MemorySegment ys = doubles(TRIALS);
        MemorySegment err = doubles(TRIALS);
        for (int i = 0; i < TRIALS; i++) {
            double dose = i * 0.5;
            double y = 90.0 / (1.0 + Math.exp(-(dose - 3.2) * 1.1));
            xs.setAtIndex(ValueLayout.JAVA_DOUBLE, i, dose);
            ys.setAtIndex(ValueLayout.JAVA_DOUBLE, i, y);
            err.setAtIndex(ValueLayout.JAVA_DOUBLE, i, 3.0 + y * 0.09);
        }
        setTitle(plot, "Yield");
        styleAxis(plot, "x", "dose (mg)", 0);
        styleAxis(plot, "y", "yield (%)", 0);

        MemorySegment desc = ph_errorbar_desc.allocate(ARENA);
        ph_errorbar_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_errorbar_desc.OFFSET_X, xs);
        desc.set(ValueLayout.ADDRESS, ph_errorbar_desc.OFFSET_Y, ys);
        desc.set(ValueLayout.JAVA_INT, ph_errorbar_desc.OFFSET_COUNT, TRIALS);
        desc.set(ValueLayout.ADDRESS, ph_errorbar_desc.OFFSET_Y_ERR_ARRAY, err);
        desc.set(ValueLayout.JAVA_INT, ph_errorbar_desc.OFFSET_BAND, 1);
        desc.set(ValueLayout.JAVA_INT, ph_errorbar_desc.OFFSET_COLOR, color("#f59e0b"));
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_errorbar(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
        addLine(plot, xs, ys, TRIALS, "#f59e0b", 2.0f, null, 0, PH_JOIN_ROUND);
    }

    /** Panel 9 — five Tukey boxes, quartiles computed by the core. */
    private static void buildLatency(long plot) {
        final double[] centre = {1.6, 2.0, 2.35, 1.85, 2.6};
        final double[] spread = {0.28, 0.34, 0.22, 0.55, 0.30};
        final int[] colors = {color("#38bdf8"), color("#22d3ee"), color("#34d399"),
                              color("#facc15"), color("#f472b6")};
        final String[] labels = {"api", "auth", "db", "cdn", "ui"};

        // The same LCG as the C panels, so the quartiles are identical here —
        // which is what makes the pixel comparison between the hosts mean
        // something.
        int seed = 987654321;
        MemorySegment groups = ARENA.allocate(ph_box_group.LAYOUT, BOXES);
        for (int b = 0; b < BOXES; b++) {
            MemorySegment values = doubles(BOX_SAMPLES);
            for (int i = 0; i < BOX_SAMPLES; i++) {
                seed = seed * 1664525 + 1013904223;
                double u = ((seed >>> 8) & 0xFFFFFF) / 16777216.0;
                seed = seed * 1664525 + 1013904223;
                double v = ((seed >>> 8) & 0xFFFFFF) / 16777216.0;
                double gauss = Math.sqrt(-2.0 * Math.log(u + 1e-12))
                    * Math.cos(6.283185307179586 * v);
                values.setAtIndex(ValueLayout.JAVA_DOUBLE, i,
                                  Math.exp(centre[b] + spread[b] * gauss));
            }
            long base = b * ph_box_group.SIZE;
            groups.set(ValueLayout.JAVA_DOUBLE, base + ph_box_group.OFFSET_POSITION, b);
            groups.set(ValueLayout.ADDRESS, base + ph_box_group.OFFSET_VALUES, values);
            groups.set(ValueLayout.JAVA_INT, base + ph_box_group.OFFSET_COUNT, BOX_SAMPLES);
            groups.set(ValueLayout.JAVA_INT, base + ph_box_group.OFFSET_COLOR, colors[b]);
        }

        setTitle(plot, "Latency");
        styleAxis(plot, "x", "service", 0);
        styleAxis(plot, "y", "ms", 0);

        try (Arena scratch = Arena.ofConfined()) {
            MemorySegment ticks = scratch.allocate(ph_tick.LAYOUT, BOXES);
            for (int i = 0; i < BOXES; i++) {
                long base = i * ph_tick.SIZE;
                ticks.set(ValueLayout.JAVA_DOUBLE, base + ph_tick.OFFSET_VALUE, i);
                ticks.set(ValueLayout.ADDRESS, base + ph_tick.OFFSET_LABEL,
                          scratch.allocateFrom(labels[i]));
                ticks.set(ValueLayout.JAVA_INT, base + ph_tick.OFFSET_GRID, PH_TOGGLE_DEFAULT);
            }
            ph_plot_set_axis_ticks(plot, scratch.allocateFrom("x"), ticks, BOXES);
        }

        MemorySegment desc = ph_box_desc.allocate(ARENA);
        ph_box_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_box_desc.OFFSET_GROUPS, groups);
        desc.set(ValueLayout.JAVA_INT, ph_box_desc.OFFSET_GROUP_COUNT, BOXES);
        desc.set(ValueLayout.JAVA_DOUBLE, ph_box_desc.OFFSET_WIDTH, 0.62);
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_box(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    /** The interference field at time `t`. It travels, driven by the clock. */
    private static void fillField(MemorySegment values, double t) {
        for (int row = 0; row < FIELD_ROWS; row++) {
            for (int col = 0; col < FIELD_COLS; col++) {
                double x = (col - FIELD_COLS * 0.5) * 0.12;
                double y = (row - FIELD_ROWS * 0.5) * 0.12;
                double r1 = Math.sqrt((x + 2.0) * (x + 2.0) + y * y);
                double r2 = Math.sqrt((x - 2.0) * (x - 2.0) + y * y);
                values.setAtIndex(ValueLayout.JAVA_DOUBLE, row * FIELD_COLS + col,
                                  Math.sin(r1 * 3.0 - t) + Math.sin(r2 * 3.0 - t));
            }
        }
    }

    /** Panel 10 — a scalar field, coloured by the core rather than by the caller. */
    private static void buildField(long plot) {
        MemorySegment values = doubles(FIELD_COLS * FIELD_ROWS);
        fillField(values, 0.0);
        fieldValues = values;

        setTitle(plot, "Field");
        styleAxis(plot, "x", "x", 0);
        styleAxis(plot, "y", "y", 0);

        MemorySegment cmap = ph_colormap_spec.allocate(ARENA);
        ph_colormap_spec_init(cmap);
        // Diverging, because the field is signed and its zero means something —
        // paired with a domain centred on it.
        cmap.set(ValueLayout.ADDRESS, ph_colormap_spec.OFFSET_NAME, ARENA.allocateFrom("RdBu"));

        MemorySegment desc = ph_heatmap_desc.allocate(ARENA);
        ph_heatmap_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_heatmap_desc.OFFSET_VALUES, values);
        desc.set(ValueLayout.JAVA_INT, ph_heatmap_desc.OFFSET_COLS, FIELD_COLS);
        desc.set(ValueLayout.JAVA_INT, ph_heatmap_desc.OFFSET_ROWS, FIELD_ROWS);
        desc.set(ValueLayout.JAVA_DOUBLE, ph_heatmap_desc.OFFSET_X + ph_range.OFFSET_LO, -6.0);
        desc.set(ValueLayout.JAVA_DOUBLE, ph_heatmap_desc.OFFSET_X + ph_range.OFFSET_HI, 6.0);
        desc.set(ValueLayout.JAVA_DOUBLE, ph_heatmap_desc.OFFSET_Y + ph_range.OFFSET_LO, -4.5);
        desc.set(ValueLayout.JAVA_DOUBLE, ph_heatmap_desc.OFFSET_Y + ph_range.OFFSET_HI, 4.5);
        desc.set(ValueLayout.ADDRESS, ph_heatmap_desc.OFFSET_COLORMAP, cmap);
        // A fixed domain, so the colours mean the same thing from frame to
        // frame — an auto-fit one would rescale as the waves move.
        desc.set(ValueLayout.JAVA_DOUBLE, ph_heatmap_desc.OFFSET_DOMAIN + ph_range.OFFSET_LO, -2.0);
        desc.set(ValueLayout.JAVA_DOUBLE, ph_heatmap_desc.OFFSET_DOMAIN + ph_range.OFFSET_HI, 2.0);
        desc.set(ValueLayout.JAVA_INT, ph_heatmap_desc.OFFSET_RENDER_TYPE, PH_RENDER_DYNAMIC);
        fieldDesc = desc;

        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_heatmap(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
        fieldLayer = out.get(ValueLayout.JAVA_LONG, 0);
    }

    /** Panel 11 — RGBA pixels placed in data space, at two filters. */
    private static void buildSprite(long plot) {
        MemorySegment pixels = ARENA.allocate(ValueLayout.JAVA_BYTE, (long) SPRITE * SPRITE * 4);
        for (int row = 0; row < SPRITE; row++) {
            for (int col = 0; col < SPRITE; col++) {
                double dx = col - (SPRITE - 1) / 2.0;
                double dy = row - (SPRITE - 1) / 2.0;
                double d = Math.sqrt(dx * dx + dy * dy) / (SPRITE / 2.0);
                double ring = d > 0.78 && d < 0.98 ? 1.0 : 0.0;
                double disc = d < 0.62 ? 1.0 - d : 0.0;
                long base = ((long) row * SPRITE + col) * 4;
                pixels.set(ValueLayout.JAVA_BYTE, base, (byte) (255.0 * (ring + disc * 0.2)));
                pixels.set(ValueLayout.JAVA_BYTE, base + 1, (byte) (255.0 * disc * 0.9));
                pixels.set(ValueLayout.JAVA_BYTE, base + 2, (byte) (255.0 * (ring * 0.3 + disc)));
                pixels.set(ValueLayout.JAVA_BYTE, base + 3,
                           (byte) (255.0 * (ring > 0.0 || disc > 0.0 ? 1.0 : 0.0)));
            }
        }

        setTitle(plot, "Sprite");
        styleAxis(plot, "x", "x", 0);
        styleAxis(plot, "y", "y", 0);

        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        MemorySegment desc = ph_image_desc.allocate(ARENA);
        ph_image_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_image_desc.OFFSET_PIXELS, pixels);
        desc.set(ValueLayout.JAVA_INT, ph_image_desc.OFFSET_WIDTH, SPRITE);
        desc.set(ValueLayout.JAVA_INT, ph_image_desc.OFFSET_HEIGHT, SPRITE);
        desc.set(ValueLayout.JAVA_DOUBLE, ph_image_desc.OFFSET_X + ph_range.OFFSET_LO, 0.0);
        desc.set(ValueLayout.JAVA_DOUBLE, ph_image_desc.OFFSET_X + ph_range.OFFSET_HI, 4.0);
        desc.set(ValueLayout.JAVA_DOUBLE, ph_image_desc.OFFSET_Y + ph_range.OFFSET_LO, 0.0);
        desc.set(ValueLayout.JAVA_DOUBLE, ph_image_desc.OFFSET_Y + ph_range.OFFSET_HI, 4.0);
        desc.set(ValueLayout.JAVA_INT, ph_image_desc.OFFSET_NO_SMOOTH, 1);
        if (ph_plot_add_image(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }

        desc.set(ValueLayout.JAVA_DOUBLE, ph_image_desc.OFFSET_X + ph_range.OFFSET_LO, 2.5);
        desc.set(ValueLayout.JAVA_DOUBLE, ph_image_desc.OFFSET_X + ph_range.OFFSET_HI, 6.5);
        desc.set(ValueLayout.JAVA_DOUBLE, ph_image_desc.OFFSET_Y + ph_range.OFFSET_LO, 1.5);
        desc.set(ValueLayout.JAVA_DOUBLE, ph_image_desc.OFFSET_Y + ph_range.OFFSET_HI, 5.5);
        desc.set(ValueLayout.JAVA_INT, ph_image_desc.OFFSET_NO_SMOOTH, 0);
        desc.set(ValueLayout.JAVA_FLOAT, ph_image_desc.OFFSET_OPACITY, 0.65f);
        if (ph_plot_add_image(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    /** The five OHLC arrays plus the session dates, shared by the last two panels. */
    private record Sessions(MemorySegment index, MemorySegment time, MemorySegment open,
                            MemorySegment high, MemorySegment low, MemorySegment close) {}

    private static Sessions sessions() {
        MemorySegment index = doubles(SESSIONS);
        MemorySegment time = doubles(SESSIONS);
        MemorySegment open = doubles(SESSIONS);
        MemorySegment high = doubles(SESSIONS);
        MemorySegment low = doubles(SESSIONS);
        MemorySegment close = doubles(SESSIONS);

        // The same LCG and the same walk as the C panels, so the two galleries
        // draw the same prices rather than similar ones.
        int seed = 24681357;
        double price = 100.0;
        double day = 1704067200000.0;  // 2024-01-01T00:00:00Z, a Monday
        for (int i = 0; i < SESSIONS; i++) {
            seed = seed * 1664525 + 1013904223;
            double drift = (((seed >>> 8) & 0xFFFFFF) / 16777216.0 - 0.48) * 3.2;
            seed = seed * 1664525 + 1013904223;
            double reach = ((seed >>> 8) & 0xFFFFFF) / 16777216.0 * 2.4 + 0.4;

            double o = price;
            double c = price + drift;
            index.setAtIndex(ValueLayout.JAVA_DOUBLE, i, i);
            time.setAtIndex(ValueLayout.JAVA_DOUBLE, i, day);
            open.setAtIndex(ValueLayout.JAVA_DOUBLE, i, o);
            close.setAtIndex(ValueLayout.JAVA_DOUBLE, i, c);
            high.setAtIndex(ValueLayout.JAVA_DOUBLE, i, Math.max(o, c) + reach);
            low.setAtIndex(ValueLayout.JAVA_DOUBLE, i, Math.min(o, c) - reach);
            price = c;

            // Skip the weekend, so consecutive indices are consecutive sessions.
            day += 86400000.0;
            if ((i + 1) % 7 == 4) day += 2.0 * 86400000.0;
        }
        return new Sessions(index, time, open, high, low, close);
    }

    private static void sessionAxis(long plot, Sessions s) {
        try (Arena scratch = Arena.ofConfined()) {
            MemorySegment axis = ph_axis_desc.allocate(scratch);
            ph_axis_desc_init(axis);
            axis.set(ValueLayout.JAVA_INT, ph_axis_desc.OFFSET_TYPE, PH_SCALE_ORDINAL_TIME);
            // The x values are indices; `times` is what turns them back into
            // dates for the tick labels.
            axis.set(ValueLayout.ADDRESS, ph_axis_desc.OFFSET_TIMES, s.time());
            axis.set(ValueLayout.JAVA_INT, ph_axis_desc.OFFSET_TIME_COUNT, SESSIONS);
            ph_plot_set_scale(plot, scratch.allocateFrom("x"), axis);
        }
        styleAxis(plot, "x", "session", 0);
        styleAxis(plot, "y", "price", 0);
    }

    /** Panel 12 — candlesticks on a session axis. */
    private static void buildCandles(long plot, Sessions s) {
        setTitle(plot, "Candles");
        sessionAxis(plot, s);

        MemorySegment desc = ph_candlestick_desc.allocate(ARENA);
        ph_candlestick_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_candlestick_desc.OFFSET_X, s.index());
        desc.set(ValueLayout.ADDRESS, ph_candlestick_desc.OFFSET_OPEN, s.open());
        desc.set(ValueLayout.ADDRESS, ph_candlestick_desc.OFFSET_HIGH, s.high());
        desc.set(ValueLayout.ADDRESS, ph_candlestick_desc.OFFSET_LOW, s.low());
        desc.set(ValueLayout.ADDRESS, ph_candlestick_desc.OFFSET_CLOSE, s.close());
        desc.set(ValueLayout.JAVA_INT, ph_candlestick_desc.OFFSET_COUNT, SESSIONS);
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_candlestick(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }

        // Annotations are what a price chart is usually marked up with: a value
        // area, the level it is measured from, and a trendline through the low.
        try (Arena scratch = Arena.ofConfined()) {
            MemorySegment id = scratch.allocate(ValueLayout.JAVA_INT);
            MemorySegment note = ph_annotation.allocate(scratch);

            ph_annotation_init(note);
            note.set(ValueLayout.JAVA_INT, ph_annotation.OFFSET_TYPE, PH_ANNOTATION_BAND);
            note.set(ValueLayout.JAVA_INT, ph_annotation.OFFSET_DIM, PH_DIM_Y);
            note.set(ValueLayout.JAVA_DOUBLE, ph_annotation.OFFSET_Y0, 96.0);
            note.set(ValueLayout.JAVA_DOUBLE, ph_annotation.OFFSET_Y1, 100.0);
            note.set(ValueLayout.JAVA_INT, ph_annotation.OFFSET_COLOR, color("#38bdf826"));
            ph_plot_add_annotation(plot, note, id);

            MemorySegment dash = scratch.allocate(ValueLayout.JAVA_FLOAT, 2);
            dash.setAtIndex(ValueLayout.JAVA_FLOAT, 0, 5.0f);
            dash.setAtIndex(ValueLayout.JAVA_FLOAT, 1, 4.0f);
            ph_annotation_init(note);
            note.set(ValueLayout.JAVA_INT, ph_annotation.OFFSET_TYPE, PH_ANNOTATION_SPAN);
            note.set(ValueLayout.JAVA_INT, ph_annotation.OFFSET_DIM, PH_DIM_Y);
            note.set(ValueLayout.JAVA_DOUBLE, ph_annotation.OFFSET_Y0, 100.0);
            note.set(ValueLayout.JAVA_INT, ph_annotation.OFFSET_COLOR, color("#94a3b8"));
            note.set(ValueLayout.ADDRESS, ph_annotation.OFFSET_DASH, dash);
            note.set(ValueLayout.JAVA_INT, ph_annotation.OFFSET_DASH_COUNT, 2);
            ph_plot_add_annotation(plot, note, id);

            ph_annotation_init(note);
            note.set(ValueLayout.JAVA_INT, ph_annotation.OFFSET_TYPE, PH_ANNOTATION_LINE);
            note.set(ValueLayout.JAVA_DOUBLE, ph_annotation.OFFSET_X0, 12.0);
            note.set(ValueLayout.JAVA_DOUBLE, ph_annotation.OFFSET_Y0, 91.0);
            note.set(ValueLayout.JAVA_DOUBLE, ph_annotation.OFFSET_X1, 33.0);
            note.set(ValueLayout.JAVA_DOUBLE, ph_annotation.OFFSET_Y1, 103.0);
            note.set(ValueLayout.JAVA_FLOAT, ph_annotation.OFFSET_WIDTH, 1.5f);
            note.set(ValueLayout.JAVA_INT, ph_annotation.OFFSET_COLOR, color("#a3e635"));
            ph_plot_add_annotation(plot, note, id);
        }
    }

    /** Panel 13 — the same sessions as OHLC bars, so the two are comparable. */
    private static void buildBars(long plot, Sessions s) {
        setTitle(plot, "Bars");
        sessionAxis(plot, s);

        MemorySegment desc = ph_ohlc_desc.allocate(ARENA);
        ph_ohlc_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_ohlc_desc.OFFSET_X, s.index());
        desc.set(ValueLayout.ADDRESS, ph_ohlc_desc.OFFSET_OPEN, s.open());
        desc.set(ValueLayout.ADDRESS, ph_ohlc_desc.OFFSET_HIGH, s.high());
        desc.set(ValueLayout.ADDRESS, ph_ohlc_desc.OFFSET_LOW, s.low());
        desc.set(ValueLayout.ADDRESS, ph_ohlc_desc.OFFSET_CLOSE, s.close());
        desc.set(ValueLayout.JAVA_INT, ph_ohlc_desc.OFFSET_COUNT, SESSIONS);
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_ohlc(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    /** Panel 14 — twenty-four thousand points as a few hundred hexagons. */
    private static void buildDensity(long plot) {
        MemorySegment xs = doubles(DENSE_POINTS);
        MemorySegment ys = doubles(DENSE_POINTS);
        int seed = 13572468;
        for (int i = 0; i < DENSE_POINTS; i++) {
            seed = seed * 1664525 + 1013904223;
            double u = ((seed >>> 8) & 0xFFFFFF) / 16777216.0;
            seed = seed * 1664525 + 1013904223;
            double v = ((seed >>> 8) & 0xFFFFFF) / 16777216.0;
            double radius = Math.sqrt(-2.0 * Math.log(u + 1e-12));
            double angle = 6.283185307179586 * v;
            double cx = (i % 3 == 0) ? 2.2 : -1.4;
            double cy = (i % 3 == 0) ? 1.1 : -0.7;
            xs.setAtIndex(ValueLayout.JAVA_DOUBLE, i, cx + radius * Math.cos(angle) * 1.15);
            ys.setAtIndex(ValueLayout.JAVA_DOUBLE, i, cy + radius * Math.sin(angle) * 0.85);
        }

        setTitle(plot, "Density");
        styleAxis(plot, "x", "x", 0);
        styleAxis(plot, "y", "y", 0);

        MemorySegment cmap = ph_colormap_spec.allocate(ARENA);
        ph_colormap_spec_init(cmap);
        cmap.set(ValueLayout.ADDRESS, ph_colormap_spec.OFFSET_NAME, ARENA.allocateFrom("magma"));

        MemorySegment desc = ph_hexbin_desc.allocate(ARENA);
        ph_hexbin_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_hexbin_desc.OFFSET_X, xs);
        desc.set(ValueLayout.ADDRESS, ph_hexbin_desc.OFFSET_Y, ys);
        desc.set(ValueLayout.JAVA_INT, ph_hexbin_desc.OFFSET_COUNT, DENSE_POINTS);
        desc.set(ValueLayout.JAVA_DOUBLE, ph_hexbin_desc.OFFSET_RADIUS, 0.16);
        desc.set(ValueLayout.ADDRESS, ph_hexbin_desc.OFFSET_COLORMAP, cmap);
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_hexbin(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    /** Panel 15 — a vector field, each arrow coloured by its own magnitude. */
    private static void buildFlow(long plot) {
        MemorySegment xs = doubles(FLOW * FLOW);
        MemorySegment ys = doubles(FLOW * FLOW);
        MemorySegment us = doubles(FLOW * FLOW);
        MemorySegment vs = doubles(FLOW * FLOW);
        for (int row = 0; row < FLOW; row++) {
            for (int col = 0; col < FLOW; col++) {
                double x = -3.0 + col * (6.0 / (FLOW - 1));
                double y = -3.0 + row * (6.0 / (FLOW - 1));
                double r2 = x * x + y * y + 0.6;
                int i = row * FLOW + col;
                xs.setAtIndex(ValueLayout.JAVA_DOUBLE, i, x);
                ys.setAtIndex(ValueLayout.JAVA_DOUBLE, i, y);
                us.setAtIndex(ValueLayout.JAVA_DOUBLE, i, (-y - x * 0.35) / r2 * 4.0);
                vs.setAtIndex(ValueLayout.JAVA_DOUBLE, i, (x - y * 0.35) / r2 * 4.0);
            }
        }

        setTitle(plot, "Flow");
        styleAxis(plot, "x", "x", 0);
        styleAxis(plot, "y", "y", 0);

        MemorySegment cmap = ph_colormap_spec.allocate(ARENA);
        ph_colormap_spec_init(cmap);
        cmap.set(ValueLayout.ADDRESS, ph_colormap_spec.OFFSET_NAME, ARENA.allocateFrom("turbo"));

        MemorySegment desc = ph_quiver_desc.allocate(ARENA);
        ph_quiver_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_quiver_desc.OFFSET_X, xs);
        desc.set(ValueLayout.ADDRESS, ph_quiver_desc.OFFSET_Y, ys);
        desc.set(ValueLayout.ADDRESS, ph_quiver_desc.OFFSET_U, us);
        desc.set(ValueLayout.ADDRESS, ph_quiver_desc.OFFSET_V, vs);
        desc.set(ValueLayout.JAVA_INT, ph_quiver_desc.OFFSET_COUNT, FLOW * FLOW);
        // No values given, so the colour follows each arrow's own magnitude.
        desc.set(ValueLayout.JAVA_INT, ph_quiver_desc.OFFSET_COLOR_BY, 1);
        desc.set(ValueLayout.ADDRESS, ph_quiver_desc.OFFSET_COLOR_MAP, cmap);
        desc.set(ValueLayout.JAVA_FLOAT, ph_quiver_desc.OFFSET_WIDTH, 2.0f);
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_quiver(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    /** Panel 16 — the Field panel's scalar field again, as iso-lines. */
    private static void buildContour(long plot) {
        MemorySegment values = doubles(FIELD_COLS * FIELD_ROWS);
        for (int row = 0; row < FIELD_ROWS; row++) {
            for (int col = 0; col < FIELD_COLS; col++) {
                double x = (col - FIELD_COLS * 0.5) * 0.12;
                double y = (row - FIELD_ROWS * 0.5) * 0.12;
                double r1 = Math.sqrt((x + 2.0) * (x + 2.0) + y * y);
                double r2 = Math.sqrt((x - 2.0) * (x - 2.0) + y * y);
                values.setAtIndex(ValueLayout.JAVA_DOUBLE, row * FIELD_COLS + col,
                                  Math.sin(r1 * 3.0) + Math.sin(r2 * 3.0));
            }
        }

        setTitle(plot, "Contour");
        styleAxis(plot, "x", "x", 0);
        styleAxis(plot, "y", "y", 0);

        MemorySegment cmap = ph_colormap_spec.allocate(ARENA);
        ph_colormap_spec_init(cmap);
        cmap.set(ValueLayout.ADDRESS, ph_colormap_spec.OFFSET_NAME, ARENA.allocateFrom("turbo"));

        MemorySegment desc = ph_contour_desc.allocate(ARENA);
        ph_contour_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_contour_desc.OFFSET_VALUES, values);
        desc.set(ValueLayout.JAVA_INT, ph_contour_desc.OFFSET_COLS, FIELD_COLS);
        desc.set(ValueLayout.JAVA_INT, ph_contour_desc.OFFSET_ROWS, FIELD_ROWS);
        desc.set(ValueLayout.JAVA_DOUBLE, ph_contour_desc.OFFSET_X + ph_range.OFFSET_LO, -6.0);
        desc.set(ValueLayout.JAVA_DOUBLE, ph_contour_desc.OFFSET_X + ph_range.OFFSET_HI, 6.0);
        desc.set(ValueLayout.JAVA_DOUBLE, ph_contour_desc.OFFSET_Y + ph_range.OFFSET_LO, -4.5);
        desc.set(ValueLayout.JAVA_DOUBLE, ph_contour_desc.OFFSET_Y + ph_range.OFFSET_HI, 4.5);
        desc.set(ValueLayout.JAVA_INT, ph_contour_desc.OFFSET_LEVEL_COUNT, ISO_LEVELS);
        // color left at PH_COLOR_AUTO, so each level takes its own colour.
        desc.set(ValueLayout.ADDRESS, ph_contour_desc.OFFSET_COLORMAP, cmap);
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_contour(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    /** Panel 17 — a graph with no positions, laid out by the core. */
    private static void buildNetwork(long plot) {
        MemorySegment edges = ARENA.allocate(ph_edge.LAYOUT, GRAPH_EDGES);
        int seed = 99887766;
        for (int i = 0; i < NODES; i++) {
            edges.set(ValueLayout.JAVA_INT, i * ph_edge.SIZE + ph_edge.OFFSET_A, i);
            edges.set(ValueLayout.JAVA_INT, i * ph_edge.SIZE + ph_edge.OFFSET_B, (i + 1) % NODES);
        }
        for (int i = NODES; i < GRAPH_EDGES; i++) {
            seed = seed * 1664525 + 1013904223;
            int a = (int) (((seed >>> 8) & 0xFFFFFF) % NODES);
            seed = seed * 1664525 + 1013904223;
            int b = (int) (((seed >>> 8) & 0xFFFFFF) % NODES);
            edges.set(ValueLayout.JAVA_INT, i * ph_edge.SIZE + ph_edge.OFFSET_A, a);
            edges.set(ValueLayout.JAVA_INT, i * ph_edge.SIZE + ph_edge.OFFSET_B,
                      b == a ? (a + NODES / 2) % NODES : b);
        }

        setTitle(plot, "Network");
        // A force layout's axes are arbitrary units, so the numbers on them
        // mean nothing; the grid would only be decoration.
        try (Arena scratch = Arena.ofConfined()) {
            for (String axis : new String[] {"x", "y"}) {
                MemorySegment bare = ph_axis_config.allocate(scratch);
                ph_axis_config_init(bare);
                bare.set(ValueLayout.JAVA_INT, ph_axis_config.OFFSET_NO_TICKS, 1);
                bare.set(ValueLayout.JAVA_INT, ph_axis_config.OFFSET_NO_GRID, 1);
                ph_plot_set_axis_config(plot, scratch.allocateFrom(axis), bare);
            }
        }

        MemorySegment desc = ph_graph_desc.allocate(ARENA);
        ph_graph_desc_init(desc);
        // No x or y: the layer lays it out, deterministically.
        desc.set(ValueLayout.JAVA_INT, ph_graph_desc.OFFSET_NODE_COUNT, NODES);
        desc.set(ValueLayout.ADDRESS, ph_graph_desc.OFFSET_EDGES, edges);
        desc.set(ValueLayout.JAVA_INT, ph_graph_desc.OFFSET_EDGE_COUNT, GRAPH_EDGES);
        desc.set(ValueLayout.JAVA_FLOAT, ph_graph_desc.OFFSET_NODE_SIZE, 9.0f);
        desc.set(ValueLayout.JAVA_INT, ph_graph_desc.OFFSET_NODE_COLOR, color("#f472b6"));
        desc.set(ValueLayout.JAVA_INT, ph_graph_desc.OFFSET_EDGE_COLOR, color("#94a3b866"));
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_graph(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    /**
     * Panel 18 — the same sessions with Bollinger Bands over them.
     *
     * The indicator is not a layer: `ph_fin_bollinger` turns one array into
     * three and three ordinary line layers draw them. Which also makes this the
     * one panel that proves the analysis half marshals — it is real output from
     * the library, not numbers this file computed in Java.
     */
    private static void buildSignals(long plot, Sessions s) {
        setTitle(plot, "Signals");
        sessionAxis(plot, s);

        MemorySegment desc = ph_candlestick_desc.allocate(ARENA);
        ph_candlestick_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_candlestick_desc.OFFSET_X, s.index());
        desc.set(ValueLayout.ADDRESS, ph_candlestick_desc.OFFSET_OPEN, s.open());
        desc.set(ValueLayout.ADDRESS, ph_candlestick_desc.OFFSET_HIGH, s.high());
        desc.set(ValueLayout.ADDRESS, ph_candlestick_desc.OFFSET_LOW, s.low());
        desc.set(ValueLayout.ADDRESS, ph_candlestick_desc.OFFSET_CLOSE, s.close());
        desc.set(ValueLayout.JAVA_INT, ph_candlestick_desc.OFFSET_COUNT, SESSIONS);
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_candlestick(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }

        MemorySegment mid = doubles(SESSIONS);
        MemorySegment up = doubles(SESSIONS);
        MemorySegment dn = doubles(SESSIONS);
        if (ph_fin_bollinger(s.close(), SESSIONS, BOLLINGER_PERIOD, 2.0, mid, up, dn) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }

        MemorySegment dash = ARENA.allocate(ValueLayout.JAVA_FLOAT, 2);
        dash.setAtIndex(ValueLayout.JAVA_FLOAT, 0, 4.0f);
        dash.setAtIndex(ValueLayout.JAVA_FLOAT, 1, 3.0f);
        addLine(plot, s.index(), mid, SESSIONS, "#facc15", 1.25f, null, 0, 0, "SMA 10");
        // The two edges share a colour and a dash: they are one band, drawn twice.
        addLine(plot, s.index(), up, SESSIONS, "#38bdf8", 1.25f, dash, 2, 0, "+2 sigma");
        addLine(plot, s.index(), dn, SESSIONS, "#38bdf8", 1.25f, dash, 2, 0, "-2 sigma");
    }

    /**
     * Panel 19 — a noisy parabola under two fits.
     *
     * The straight line is what ordinary least squares has to say about a
     * symmetric parabola, which is nothing. LOESS, fitting locally, recovers
     * the curve; drawing both is the point.
     */
    private static void buildFit(long plot) {
        MemorySegment xs = doubles(FIT_POINTS);
        MemorySegment ys = doubles(FIT_POINTS);
        int seed = 24681357;
        for (int i = 0; i < FIT_POINTS; i++) {
            double x = -3.0 + i * (6.0 / (FIT_POINTS - 1));
            seed = seed * 1664525 + 1013904223;
            double noise = (((seed >>> 8) & 0xFFFFFF) / 16777216.0 - 0.5) * 2.4;
            xs.setAtIndex(ValueLayout.JAVA_DOUBLE, i, x);
            ys.setAtIndex(ValueLayout.JAVA_DOUBLE, i, 0.6 * x * x - 0.4 * x + 1.0 + noise);
        }

        MemorySegment gridX = doubles(FIT_GRID);
        MemorySegment gridY = doubles(FIT_GRID);
        MemorySegment count = ARENA.allocate(ValueLayout.JAVA_INT);
        if (ph_stat_loess(xs, ys, FIT_POINTS, 0.3, FIT_GRID, gridX, gridY, FIT_GRID, count)
                != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
        MemorySegment trendX = doubles(2);
        MemorySegment trendY = doubles(2);
        if (ph_stat_linear_trend(xs, ys, FIT_POINTS, 2, 0.0, trendX, trendY, MemorySegment.NULL,
                                 MemorySegment.NULL) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }

        setTitle(plot, "Fit");
        ph_plot_set_pick_mode(plot, PH_PICK_XY);
        styleAxis(plot, "x", "x", 0);
        styleAxis(plot, "y", "y", 0);

        MemorySegment desc = ph_scatter_desc.allocate(ARENA);
        ph_scatter_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_scatter_desc.OFFSET_X, xs);
        desc.set(ValueLayout.ADDRESS, ph_scatter_desc.OFFSET_Y, ys);
        desc.set(ValueLayout.JAVA_INT, ph_scatter_desc.OFFSET_COUNT, FIT_POINTS);
        desc.set(ValueLayout.JAVA_FLOAT, ph_scatter_desc.OFFSET_SIZE, 4.0f);
        desc.set(ValueLayout.JAVA_INT, ph_scatter_desc.OFFSET_COLOR, color("#64748b"));
        desc.set(ValueLayout.JAVA_INT, ph_scatter_desc.OFFSET_MARKER, PH_MARKER_CIRCLE);
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_scatter(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }

        MemorySegment dash = ARENA.allocate(ValueLayout.JAVA_FLOAT, 2);
        dash.setAtIndex(ValueLayout.JAVA_FLOAT, 0, 6.0f);
        dash.setAtIndex(ValueLayout.JAVA_FLOAT, 1, 4.0f);
        addLine(plot, trendX, trendY, 2, "#f87171", 1.5f, dash, 2, 0, "least squares");
        addLine(plot, gridX, gridY, FIT_GRID, "#22d3ee", 2.5f, null, 0, 0, "loess");
    }

    /**
     * Panel 20 — a power spectral density on a log axis.
     *
     * Two tones buried in broadband noise. Welch averages eight overlapping
     * segments, which pushes the noise floor down and leaves the tones standing.
     */
    private static void buildSpectrum(long plot) {
        MemorySegment signal = doubles(PSD_SAMPLES);
        int seed = 31415926;
        for (int i = 0; i < PSD_SAMPLES; i++) {
            double t = i / PSD_RATE;
            seed = seed * 1664525 + 1013904223;
            double noise = (((seed >>> 8) & 0xFFFFFF) / 16777216.0 - 0.5) * 0.8;
            signal.setAtIndex(ValueLayout.JAVA_DOUBLE, i,
                Math.sin(2 * Math.PI * 24.0 * t) + 0.5 * Math.sin(2 * Math.PI * 61.0 * t) + noise);
        }
        MemorySegment freq = doubles(PSD_BINS);
        MemorySegment power = doubles(PSD_BINS);
        MemorySegment bins = ARENA.allocate(ValueLayout.JAVA_INT);
        if (ph_stat_welch(signal, PSD_SAMPLES, PSD_SEGMENT, 0.5, PH_WINDOW_HANN, PSD_RATE, freq,
                          power, PSD_BINS, bins) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }

        setTitle(plot, "Spectrum");
        styleAxis(plot, "x", "frequency (Hz)", 0);
        styleAxis(plot, "y", "power", 0);
        // Power spans four decades, so a linear axis would show one spike and a
        // flat line where the noise floor is.
        try (Arena scratch = Arena.ofConfined()) {
            MemorySegment axis = ph_axis_desc.allocate(scratch);
            ph_axis_desc_init(axis);
            axis.set(ValueLayout.JAVA_INT, ph_axis_desc.OFFSET_TYPE, PH_SCALE_LOG);
            ph_plot_set_scale(plot, scratch.allocateFrom("y"), axis);
        }
        addLine(plot, freq, power, bins.get(ValueLayout.JAVA_INT, 0), "#a3e635", 1.5f, null, 0, 0);
    }

    /** Panel 21 — a ROC curve with the chance diagonal behind it. */
    private static void buildRoc(long plot) {
        MemorySegment scores = doubles(ROC_SAMPLES);
        MemorySegment labels = doubles(ROC_SAMPLES);
        int seed = 55443322;
        for (int i = 0; i < ROC_SAMPLES; i++) {
            boolean positive = (i % 2) == 0;
            seed = seed * 1664525 + 1013904223;
            double u = ((seed >>> 8) & 0xFFFFFF) / 16777216.0;
            seed = seed * 1664525 + 1013904223;
            double v = ((seed >>> 8) & 0xFFFFFF) / 16777216.0;
            // Box-Muller, so the two score distributions are Gaussian and overlap.
            double g = Math.sqrt(-2.0 * Math.log(u + 1e-12)) * Math.cos(2 * Math.PI * v);
            labels.setAtIndex(ValueLayout.JAVA_DOUBLE, i, positive ? 1.0 : 0.0);
            scores.setAtIndex(ValueLayout.JAVA_DOUBLE, i, (positive ? 1.1 : -1.1) + g * 0.9);
        }
        MemorySegment fpr = doubles(ROC_SAMPLES + 1);
        MemorySegment tpr = doubles(ROC_SAMPLES + 1);
        MemorySegment count = ARENA.allocate(ValueLayout.JAVA_INT);
        MemorySegment auc = ARENA.allocate(ValueLayout.JAVA_DOUBLE);
        if (ph_ml_roc_curve(scores, labels, ROC_SAMPLES, fpr, tpr, MemorySegment.NULL,
                            ROC_SAMPLES + 1, count, auc) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }

        // The AUC goes in the title because a ROC curve without it is half a chart.
        int hundredths = (int) (auc.get(ValueLayout.JAVA_DOUBLE, 0) * 100.0 + 0.5);
        setTitle(plot, String.format("ROC %d.%02d", hundredths / 100, hundredths % 100));
        styleAxis(plot, "x", "false positive rate", 0);
        styleAxis(plot, "y", "true positive rate", 0);

        MemorySegment dash = ARENA.allocate(ValueLayout.JAVA_FLOAT, 2);
        dash.setAtIndex(ValueLayout.JAVA_FLOAT, 0, 5.0f);
        dash.setAtIndex(ValueLayout.JAVA_FLOAT, 1, 5.0f);
        MemorySegment chance = doubles(2);
        chance.setAtIndex(ValueLayout.JAVA_DOUBLE, 1, 1.0);
        addLine(plot, chance, chance, 2, "#64748b", 1.0f, dash, 2, 0, "chance");
        addLine(plot, fpr, tpr, count.get(ValueLayout.JAVA_INT, 0), "#f472b6", 2.0f, null, 0, 0,
                "model");
    }

    /**
     * Panel 22 — three four-dimensional clusters projected to two by PCA.
     *
     * The colours are the true classes, which the projection never saw: the
     * clusters separating is the projection's doing, not the palette's.
     */
    private static void buildEmbedding(long plot) {
        double[][] centres = {{2.5, 0.0, -1.0, 0.5}, {-2.0, 2.0, 0.5, -1.0}, {0.0, -2.5, 2.0, 1.5}};
        String[] classColor = {"#60a5fa", "#f59e0b", "#34d399"};
        MemorySegment raw = doubles(EMBED_POINTS * EMBED_DIMS);
        MemorySegment colors = ARENA.allocate(ValueLayout.JAVA_INT, EMBED_POINTS);
        int seed = 77665544;
        for (int i = 0; i < EMBED_POINTS; i++) {
            int cluster = i % 3;
            for (int d = 0; d < EMBED_DIMS; d++) {
                seed = seed * 1664525 + 1013904223;
                double u = ((seed >>> 8) & 0xFFFFFF) / 16777216.0;
                seed = seed * 1664525 + 1013904223;
                double v = ((seed >>> 8) & 0xFFFFFF) / 16777216.0;
                double g = Math.sqrt(-2.0 * Math.log(u + 1e-12)) * Math.cos(2 * Math.PI * v);
                raw.setAtIndex(ValueLayout.JAVA_DOUBLE, i * EMBED_DIMS + d,
                               centres[cluster][d] + g * 0.55);
            }
            colors.setAtIndex(ValueLayout.JAVA_INT, i, color(classColor[cluster]));
        }
        MemorySegment scores = doubles(EMBED_POINTS * 2);
        if (ph_ml_pca(raw, EMBED_POINTS, EMBED_DIMS, 2, scores, MemorySegment.NULL,
                      MemorySegment.NULL, MemorySegment.NULL) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
        MemorySegment xs = doubles(EMBED_POINTS);
        MemorySegment ys = doubles(EMBED_POINTS);
        for (int i = 0; i < EMBED_POINTS; i++) {
            xs.setAtIndex(ValueLayout.JAVA_DOUBLE, i, scores.getAtIndex(ValueLayout.JAVA_DOUBLE, i * 2));
            ys.setAtIndex(ValueLayout.JAVA_DOUBLE, i, scores.getAtIndex(ValueLayout.JAVA_DOUBLE, i * 2 + 1));
        }

        setTitle(plot, "Embedding");
        ph_plot_set_pick_mode(plot, PH_PICK_XY);
        styleAxis(plot, "x", "PC 1", 0);
        styleAxis(plot, "y", "PC 2", 0);

        MemorySegment desc = ph_scatter_desc.allocate(ARENA);
        ph_scatter_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_scatter_desc.OFFSET_X, xs);
        desc.set(ValueLayout.ADDRESS, ph_scatter_desc.OFFSET_Y, ys);
        desc.set(ValueLayout.JAVA_INT, ph_scatter_desc.OFFSET_COUNT, EMBED_POINTS);
        desc.set(ValueLayout.JAVA_FLOAT, ph_scatter_desc.OFFSET_SIZE, 5.0f);
        desc.set(ValueLayout.ADDRESS, ph_scatter_desc.OFFSET_COLORS, colors);
        desc.set(ValueLayout.JAVA_INT, ph_scatter_desc.OFFSET_MARKER, PH_MARKER_CIRCLE);
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_scatter(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    /** Axes with no meaning to show: a composed chart's coordinates are arbitrary. */
    private static void bareAxes(long plot) {
        try (Arena scratch = Arena.ofConfined()) {
            for (String axis : new String[] {"x", "y"}) {
                MemorySegment bare = ph_axis_config.allocate(scratch);
                ph_axis_config_init(bare);
                bare.set(ValueLayout.JAVA_INT, ph_axis_config.OFFSET_NO_TICKS, 1);
                bare.set(ValueLayout.JAVA_INT, ph_axis_config.OFFSET_NO_GRID, 1);
                ph_plot_set_axis_config(plot, scratch.allocateFrom(axis), bare);
            }
        }
    }

    /** Panel 23 — a squarified treemap of eight products. */
    private static void buildTreemap(long plot) {
        String[] products = {"Search", "Cloud", "Ads", "Devices", "Media", "Support", "Labs", "Other"};
        double[] share = {38, 24, 16, 9, 6, 4, 2, 1};
        MemorySegment items = ARENA.allocate(ph_chart_item.LAYOUT, TREEMAP_ITEMS);
        for (int i = 0; i < TREEMAP_ITEMS; i++) {
            long base = ph_chart_item.SIZE * i;
            items.set(ValueLayout.ADDRESS, base + ph_chart_item.OFFSET_LABEL,
                      ARENA.allocateFrom(products[i]));
            items.set(ValueLayout.JAVA_DOUBLE, base + ph_chart_item.OFFSET_VALUE, share[i]);
        }
        setTitle(plot, "Treemap");
        bareAxes(plot);

        MemorySegment desc = ph_treemap_desc.allocate(ARENA);
        ph_treemap_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_treemap_desc.OFFSET_ITEMS, items);
        desc.set(ValueLayout.JAVA_INT, ph_treemap_desc.OFFSET_ITEM_COUNT, TREEMAP_ITEMS);
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_treemap(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    /** The regions-and-cities hierarchy the sunburst draws, flattened. */
    private static MemorySegment treeNodes() {
        String[] names = {"world", "EMEA", "APAC", "AMER", "London", "Berlin", "Paris",
                          "Tokyo", "Seoul", "Sydney", "NYC", "SF", "Toronto"};
        int[] parent = {-1, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3};
        double[] value = {0, 0, 0, 0, 5, 4, 3, 6, 3, 2, 7, 5, 2};
        MemorySegment nodes = ARENA.allocate(ph_tree_node.LAYOUT, TREE_NODES);
        for (int i = 0; i < TREE_NODES; i++) {
            long base = ph_tree_node.SIZE * i;
            nodes.set(ValueLayout.ADDRESS, base + ph_tree_node.OFFSET_NAME,
                      ARENA.allocateFrom(names[i]));
            nodes.set(ValueLayout.JAVA_INT, base + ph_tree_node.OFFSET_PARENT, parent[i]);
            nodes.set(ValueLayout.JAVA_DOUBLE, base + ph_tree_node.OFFSET_VALUE, value[i]);
        }
        return nodes;
    }

    /** Panel 24 — the same kind of data as a hierarchy, drawn radially. */
    private static void buildSunburst(long plot) {
        setTitle(plot, "Sunburst");
        bareAxes(plot);
        // The rings are circles only if one data unit is the same length on
        // both axes, which is the whole job of the equal-aspect lock.
        ph_plot_set_equal_aspect(plot, 1);

        MemorySegment desc = ph_sunburst_desc.allocate(ARENA);
        ph_sunburst_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_sunburst_desc.OFFSET_NODES, treeNodes());
        desc.set(ValueLayout.JAVA_INT, ph_sunburst_desc.OFFSET_NODE_COUNT, TREE_NODES);
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_sunburst(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    /** Panel 25 — where the energy goes. */
    private static void buildSankey(long plot) {
        String[] names = {"coal", "gas", "grid", "loss", "homes", "works"};
        int[][] wiring = {{0, 2, 30}, {1, 2, 45}, {2, 3, 18}, {2, 4, 34}, {2, 5, 23}, {1, 5, 6}};
        MemorySegment nodes = ARENA.allocate(ph_flow_node.LAYOUT, FLOW_NODES);
        for (int i = 0; i < FLOW_NODES; i++) {
            nodes.set(ValueLayout.ADDRESS, ph_flow_node.SIZE * i + ph_flow_node.OFFSET_NAME,
                      ARENA.allocateFrom(names[i]));
        }
        MemorySegment links = ARENA.allocate(ph_flow.LAYOUT, FLOW_LINKS);
        for (int i = 0; i < FLOW_LINKS; i++) {
            long base = ph_flow.SIZE * i;
            links.set(ValueLayout.JAVA_INT, base + ph_flow.OFFSET_SOURCE, wiring[i][0]);
            links.set(ValueLayout.JAVA_INT, base + ph_flow.OFFSET_TARGET, wiring[i][1]);
            links.set(ValueLayout.JAVA_DOUBLE, base + ph_flow.OFFSET_VALUE, wiring[i][2]);
        }
        setTitle(plot, "Sankey");
        bareAxes(plot);

        MemorySegment desc = ph_sankey_desc.allocate(ARENA);
        ph_sankey_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_sankey_desc.OFFSET_NODES, nodes);
        desc.set(ValueLayout.JAVA_INT, ph_sankey_desc.OFFSET_NODE_COUNT, FLOW_NODES);
        desc.set(ValueLayout.ADDRESS, ph_sankey_desc.OFFSET_LINKS, links);
        desc.set(ValueLayout.JAVA_INT, ph_sankey_desc.OFFSET_LINK_COUNT, FLOW_LINKS);
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_sankey(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    /** Panel 26 — a trade matrix as a chord diagram. */
    private static void buildChord(long plot) {
        String[] regions = {"EU", "US", "CN", "JP"};
        double[] trade = {0, 12, 7, 4, 9, 0, 11, 3, 5, 8, 0, 14, 6, 2, 10, 0};
        MemorySegment matrix = doubles(CHORD_GROUPS * CHORD_GROUPS);
        for (int i = 0; i < trade.length; i++) {
            matrix.setAtIndex(ValueLayout.JAVA_DOUBLE, i, trade[i]);
        }
        MemorySegment labels = ARENA.allocate(ValueLayout.ADDRESS, CHORD_GROUPS);
        for (int i = 0; i < CHORD_GROUPS; i++) {
            labels.setAtIndex(ValueLayout.ADDRESS, i, ARENA.allocateFrom(regions[i]));
        }
        setTitle(plot, "Chord");
        bareAxes(plot);
        ph_plot_set_equal_aspect(plot, 1);

        MemorySegment desc = ph_chord_desc.allocate(ARENA);
        ph_chord_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_chord_desc.OFFSET_MATRIX, matrix);
        desc.set(ValueLayout.JAVA_INT, ph_chord_desc.OFFSET_COUNT, CHORD_GROUPS);
        desc.set(ValueLayout.ADDRESS, ph_chord_desc.OFFSET_LABELS, labels);
        desc.set(ValueLayout.JAVA_INT, ph_chord_desc.OFFSET_LABEL_COUNT, CHORD_GROUPS);
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_chord(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    /** Panel 27 — a gauge with two threshold bands. */
    private static void buildGauge(long plot) {
        MemorySegment bands = ARENA.allocate(ph_gauge_threshold.LAYOUT, 2);
        bands.set(ValueLayout.JAVA_DOUBLE, ph_gauge_threshold.OFFSET_VALUE, 50.0);
        bands.set(ValueLayout.JAVA_INT, ph_gauge_threshold.OFFSET_COLOR, color("#f59e0b"));
        bands.set(ValueLayout.JAVA_DOUBLE,
                  ph_gauge_threshold.SIZE + ph_gauge_threshold.OFFSET_VALUE, 80.0);
        bands.set(ValueLayout.JAVA_INT,
                  ph_gauge_threshold.SIZE + ph_gauge_threshold.OFFSET_COLOR, color("#ef4444"));

        setTitle(plot, "Gauge");
        bareAxes(plot);
        ph_plot_set_equal_aspect(plot, 1);

        MemorySegment desc = ph_gauge_desc.allocate(ARENA);
        ph_gauge_desc_init(desc);
        desc.set(ValueLayout.JAVA_DOUBLE, ph_gauge_desc.OFFSET_VALUE, 62.0);
        desc.set(ValueLayout.ADDRESS, ph_gauge_desc.OFFSET_THRESHOLDS, bands);
        desc.set(ValueLayout.JAVA_INT, ph_gauge_desc.OFFSET_THRESHOLD_COUNT, 2);
        desc.set(ValueLayout.JAVA_INT, ph_gauge_desc.OFFSET_TRACK_COLOR, color("#33415566"));
        desc.set(ValueLayout.JAVA_INT, ph_gauge_desc.OFFSET_NEEDLE_COLOR, color("#e2e8f0"));
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_gauge(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    /**
     * Panel 28 — parallel coordinates over two classes.
     *
     * The one builder that returns several layers, because a row is a line and
     * a line is a layer: forty rows, forty handles.
     */
    private static void buildParallel(long plot) {
        String[] dims = {"sepal", "petal", "weight", "score"};
        MemorySegment rows = doubles(PARALLEL_ROWS * PARALLEL_DIMS);
        MemorySegment classes = doubles(PARALLEL_ROWS);
        int seed = 19283746;
        for (int r = 0; r < PARALLEL_ROWS; r++) {
            int cls = r % 2;
            classes.setAtIndex(ValueLayout.JAVA_DOUBLE, r, cls);
            for (int d = 0; d < PARALLEL_DIMS; d++) {
                seed = seed * 1664525 + 1013904223;
                double noise = (((seed >>> 8) & 0xFFFFFF) / 16777216.0 - 0.5) * 0.6;
                double base = cls == 1 ? 1.0 + d * 0.4 : 3.0 - d * 0.5;
                rows.setAtIndex(ValueLayout.JAVA_DOUBLE, r * PARALLEL_DIMS + d, base + noise);
            }
        }
        MemorySegment names = ARENA.allocate(ValueLayout.ADDRESS, PARALLEL_DIMS);
        for (int i = 0; i < PARALLEL_DIMS; i++) {
            names.setAtIndex(ValueLayout.ADDRESS, i, ARENA.allocateFrom(dims[i]));
        }

        setTitle(plot, "Parallel");
        try (Arena scratch = Arena.ofConfined()) {
            MemorySegment bare = ph_axis_config.allocate(scratch);
            ph_axis_config_init(bare);
            bare.set(ValueLayout.JAVA_INT, ph_axis_config.OFFSET_NO_TICKS, 1);
            bare.set(ValueLayout.JAVA_INT, ph_axis_config.OFFSET_NO_GRID, 1);
            ph_plot_set_axis_config(plot, scratch.allocateFrom("x"), bare);
        }
        styleAxis(plot, "y", "normalised", 0);

        MemorySegment desc = ph_parallel_desc.allocate(ARENA);
        ph_parallel_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_parallel_desc.OFFSET_DIMENSIONS, names);
        desc.set(ValueLayout.JAVA_INT, ph_parallel_desc.OFFSET_DIM_COUNT, PARALLEL_DIMS);
        desc.set(ValueLayout.ADDRESS, ph_parallel_desc.OFFSET_ROWS, rows);
        desc.set(ValueLayout.JAVA_INT, ph_parallel_desc.OFFSET_ROW_COUNT, PARALLEL_ROWS);
        desc.set(ValueLayout.ADDRESS, ph_parallel_desc.OFFSET_COLOR_BY, classes);
        desc.set(ValueLayout.JAVA_FLOAT, ph_parallel_desc.OFFSET_WIDTH, 1.5f);
        MemorySegment layers = ARENA.allocate(ValueLayout.JAVA_LONG, PARALLEL_ROWS);
        MemorySegment written = ARENA.allocate(ValueLayout.JAVA_INT);
        if (ph_plot_add_parallel(plot, desc, layers, PARALLEL_ROWS, written) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    /** The three revenue streams the grouped and stacked panels share. */
    private static MemorySegment streams() {
        double[] revenue = {42, 47, 51, 49, 58, 63, 61, 68, 72, 70, 78, 84};
        double[] weight = {0.55, 0.3, 0.15};
        String[] names = {"licence", "services", "support"};
        String[] colors = {"#60a5fa", "#f59e0b", "#34d399"};
        MemorySegment series = ARENA.allocate(ph_series.LAYOUT, STREAMS);
        for (int s = 0; s < STREAMS; s++) {
            MemorySegment y = doubles(MONTHS);
            for (int m = 0; m < MONTHS; m++) {
                y.setAtIndex(ValueLayout.JAVA_DOUBLE, m, revenue[m] * weight[s]);
            }
            long base = ph_series.SIZE * s;
            series.set(ValueLayout.ADDRESS, base + ph_series.OFFSET_Y, y);
            series.set(ValueLayout.JAVA_INT, base + ph_series.OFFSET_COLOR, color(colors[s]));
            series.set(ValueLayout.ADDRESS, base + ph_series.OFFSET_NAME,
                       ARENA.allocateFrom(names[s]));
        }
        return series;
    }

    private static MemorySegment months() {
        MemorySegment x = doubles(MONTHS);
        for (int i = 0; i < MONTHS; i++) x.setAtIndex(ValueLayout.JAVA_DOUBLE, i, i);
        return x;
    }

    /** Panel 29 — the same three streams as clusters. */
    private static void buildGrouped(long plot) {
        setTitle(plot, "Grouped");
        styleAxis(plot, "x", "month", 0);
        styleAxis(plot, "y", "revenue", 0);

        MemorySegment desc = ph_grouped_bar_desc.allocate(ARENA);
        ph_grouped_bar_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_grouped_bar_desc.OFFSET_X, months());
        desc.set(ValueLayout.JAVA_INT, ph_grouped_bar_desc.OFFSET_COUNT, MONTHS);
        desc.set(ValueLayout.ADDRESS, ph_grouped_bar_desc.OFFSET_SERIES, streams());
        desc.set(ValueLayout.JAVA_INT, ph_grouped_bar_desc.OFFSET_SERIES_COUNT, STREAMS);
        MemorySegment layers = ARENA.allocate(ValueLayout.JAVA_LONG, STREAMS);
        MemorySegment written = ARENA.allocate(ValueLayout.JAVA_INT);
        if (ph_plot_add_grouped_bars(plot, desc, layers, STREAMS, written) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    /** Panel 30 — and stacked, which is the same numbers reading as a total. */
    private static void buildStacked(long plot) {
        setTitle(plot, "Stacked");
        styleAxis(plot, "x", "month", 0);
        styleAxis(plot, "y", "revenue", 0);
        try (Arena scratch = Arena.ofConfined()) {
            MemorySegment legend = ph_legend_config.allocate(scratch);
            ph_legend_config_init(legend);
            // `enabled` is the one field that is off by default.
            legend.set(ValueLayout.JAVA_INT, ph_legend_config.OFFSET_ENABLED, 1);
            legend.set(ValueLayout.JAVA_INT, ph_legend_config.OFFSET_POSITION, PH_LEGEND_TOP_LEFT);
            ph_plot_set_legend(plot, legend);
        }

        MemorySegment desc = ph_stacked_desc.allocate(ARENA);
        ph_stacked_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_stacked_desc.OFFSET_X, months());
        desc.set(ValueLayout.JAVA_INT, ph_stacked_desc.OFFSET_COUNT, MONTHS);
        desc.set(ValueLayout.ADDRESS, ph_stacked_desc.OFFSET_SERIES, streams());
        desc.set(ValueLayout.JAVA_INT, ph_stacked_desc.OFFSET_SERIES_COUNT, STREAMS);
        MemorySegment layers = ARENA.allocate(ValueLayout.JAVA_LONG, STREAMS);
        MemorySegment written = ARENA.allocate(ValueLayout.JAVA_INT);
        if (ph_plot_add_stacked_area(plot, desc, layers, STREAMS, written) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    /** Panel 31 — a bimodal sample binned into bars. */
    private static void buildHistogram(long plot) {
        MemorySegment values = doubles(HIST_SAMPLES);
        int seed = 44556677;
        for (int i = 0; i < HIST_SAMPLES; i++) {
            seed = seed * 1664525 + 1013904223;
            double u = ((seed >>> 8) & 0xFFFFFF) / 16777216.0;
            seed = seed * 1664525 + 1013904223;
            double v = ((seed >>> 8) & 0xFFFFFF) / 16777216.0;
            double g = Math.sqrt(-2.0 * Math.log(u + 1e-12)) * Math.cos(2 * Math.PI * v);
            values.setAtIndex(ValueLayout.JAVA_DOUBLE, i,
                              (i % 3 == 0 ? 6.0 : 2.0) + g * (i % 3 == 0 ? 0.8 : 1.2));
        }
        setTitle(plot, "Histogram");
        styleAxis(plot, "x", "value", 0);
        styleAxis(plot, "y", "count", 0);

        MemorySegment desc = ph_histogram_desc.allocate(ARENA);
        ph_histogram_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_histogram_desc.OFFSET_VALUES, values);
        desc.set(ValueLayout.JAVA_INT, ph_histogram_desc.OFFSET_COUNT, HIST_SAMPLES);
        desc.set(ValueLayout.JAVA_INT, ph_histogram_desc.OFFSET_BINS, 40);
        desc.set(ValueLayout.JAVA_INT, ph_histogram_desc.OFFSET_COLOR, color("#38bdf8"));
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_histogram(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    /**
     * Panel 32 — the Spectrum panel's signal as a time-frequency image.
     *
     * The same two tones seen the other way round: the PSD says what
     * frequencies are there, the spectrogram says when.
     */
    private static void buildSpectrogram(long plot) {
        MemorySegment signal = doubles(PSD_SAMPLES);
        int seed = 31415926;
        for (int i = 0; i < PSD_SAMPLES; i++) {
            double t = i / PSD_RATE;
            seed = seed * 1664525 + 1013904223;
            double noise = (((seed >>> 8) & 0xFFFFFF) / 16777216.0 - 0.5) * 0.8;
            signal.setAtIndex(ValueLayout.JAVA_DOUBLE, i,
                Math.sin(2 * Math.PI * 24.0 * t) + 0.5 * Math.sin(2 * Math.PI * 61.0 * t) + noise);
        }
        setTitle(plot, "Spectrogram");
        styleAxis(plot, "x", "time (s)", 0);
        styleAxis(plot, "y", "frequency (Hz)", 0);

        MemorySegment desc = ph_spectrogram_desc.allocate(ARENA);
        ph_spectrogram_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_spectrogram_desc.OFFSET_SIGNAL, signal);
        desc.set(ValueLayout.JAVA_INT, ph_spectrogram_desc.OFFSET_COUNT, PSD_SAMPLES);
        desc.set(ValueLayout.JAVA_INT, ph_spectrogram_desc.OFFSET_FFT_SIZE, 128);
        desc.set(ValueLayout.JAVA_DOUBLE, ph_spectrogram_desc.OFFSET_SAMPLE_RATE, PSD_RATE);
        desc.set(ValueLayout.ADDRESS, ph_spectrogram_desc.OFFSET_NAME, ARENA.allocateFrom("dB"));
        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        if (ph_plot_add_spectrogram(plot, desc, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    /**
     * Panel 33 — a polar plot, which is a mode rather than a type.
     *
     * The same plot handle, the same render, the same events: what differs is
     * that the grid is rings and spokes, the two axes share a square domain,
     * and (theta, r) is projected on the way in.
     */
    private static void buildPolar(long plot) {
        MemorySegment theta = doubles(ROSE_POINTS);
        MemorySegment radius = doubles(ROSE_POINTS);
        for (int i = 0; i < ROSE_POINTS; i++) {
            theta.setAtIndex(ValueLayout.JAVA_DOUBLE, i, i);
            radius.setAtIndex(ValueLayout.JAVA_DOUBLE, i,
                              Math.abs(Math.cos(2.0 * i * Math.PI / 180.0)));
        }
        MemorySegment markTheta = doubles(ROSE_MARKS);
        MemorySegment markR = doubles(ROSE_MARKS);
        for (int i = 0; i < ROSE_MARKS; i++) {
            markTheta.setAtIndex(ValueLayout.JAVA_DOUBLE, i, i * 30.0);
            markR.setAtIndex(ValueLayout.JAVA_DOUBLE, i, 0.55 + 0.35 * Math.sin(i * 0.9));
        }

        setTitle(plot, "Polar");
        try (Arena scratch = Arena.ofConfined()) {
            MemorySegment config = ph_polar_config.allocate(scratch);
            ph_polar_config_init(config);
            config.set(ValueLayout.JAVA_INT, ph_polar_config.OFFSET_ENABLED, 1);
            config.set(ValueLayout.JAVA_INT, ph_polar_config.OFFSET_DEGREES, 1);
            if (ph_plot_set_polar(plot, config) != PH_OK) {
                throw new IllegalStateException(Photon.lastError());
            }
        }

        MemorySegment out = ARENA.allocate(ValueLayout.JAVA_LONG);
        MemorySegment rose = ph_polar_line_desc.allocate(ARENA);
        ph_polar_line_desc_init(rose);
        rose.set(ValueLayout.ADDRESS, ph_polar_line_desc.OFFSET_THETA, theta);
        rose.set(ValueLayout.ADDRESS, ph_polar_line_desc.OFFSET_R, radius);
        rose.set(ValueLayout.JAVA_INT, ph_polar_line_desc.OFFSET_COUNT, ROSE_POINTS);
        rose.set(ValueLayout.JAVA_INT, ph_polar_line_desc.OFFSET_COLOR, color("#22d3ee"));
        rose.set(ValueLayout.JAVA_FLOAT, ph_polar_line_desc.OFFSET_WIDTH, 2.0f);
        rose.set(ValueLayout.JAVA_INT, ph_polar_line_desc.OFFSET_CLOSED, 1);
        if (ph_plot_add_polar_line(plot, rose, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }

        MemorySegment marks = ph_polar_scatter_desc.allocate(ARENA);
        ph_polar_scatter_desc_init(marks);
        marks.set(ValueLayout.ADDRESS, ph_polar_scatter_desc.OFFSET_THETA, markTheta);
        marks.set(ValueLayout.ADDRESS, ph_polar_scatter_desc.OFFSET_R, markR);
        marks.set(ValueLayout.JAVA_INT, ph_polar_scatter_desc.OFFSET_COUNT, ROSE_MARKS);
        marks.set(ValueLayout.JAVA_INT, ph_polar_scatter_desc.OFFSET_COLOR, color("#f472b6"));
        marks.set(ValueLayout.JAVA_FLOAT, ph_polar_scatter_desc.OFFSET_SIZE, 7.0f);
        marks.set(ValueLayout.JAVA_INT, ph_polar_scatter_desc.OFFSET_MARKER, PH_MARKER_CIRCLE);
        if (ph_plot_add_polar_scatter(plot, marks, out) != PH_OK) {
            throw new IllegalStateException(Photon.lastError());
        }
    }

    private static void advanceStream(double seconds) {
        if (fieldLayer != PH_NULL_HANDLE) {
            // Two circular waves travelling outwards — the case a heatmap
            // setter is for, and the reason the layer keeps its texture instead
            // of being destroyed and re-added sixty times a second.
            fillField(fieldValues, seconds * 2.0);
            ph_layer_set_heatmap(fieldLayer, fieldDesc);
        }
        for (int i = 0; i < STREAM_POINTS; i++) {
            double phase = seconds * 2.0 + i * 0.035;
            streamY.setAtIndex(ValueLayout.JAVA_DOUBLE, i,
                Math.sin(phase) + 0.4 * Math.sin(phase * 3.1 + 1.0) + 0.15 * Math.sin(phase * 7.7));
        }
        ph_layer_set_xy(streamLayer, streamX, streamY, STREAM_POINTS);
    }

    // -----------------------------------------------------------------------
    // Window, layout and input
    // -----------------------------------------------------------------------

    private static int rows() {
        return (PANELS + COLUMNS - 1) / COLUMNS;
    }

    private static int[] windowSize() {
        try (MemoryStack stack = MemoryStack.stackPush()) {
            int[] width = new int[1];
            int[] height = new int[1];
            GLFW.glfwGetWindowSize(window, width, height);
            return new int[] {width[0], height[0]};
        }
    }

    private static int[] framebufferSize() {
        int[] width = new int[1];
        int[] height = new int[1];
        GLFW.glfwGetFramebufferSize(window, width, height);
        return new int[] {width[0], height[0]};
    }

    /** Which cell (mx, my) falls in, in logical window coordinates. */
    private static int cellAt(double mx, double my) {
        int[] size = windowSize();
        double cw = (double) size[0] / COLUMNS;
        double ch = (double) size[1] / rows();
        if (cw <= 0 || ch <= 0) return -1;
        int column = (int) Math.floor(mx / cw);
        int row = (int) Math.floor(my / ch);
        if (column < 0 || column >= COLUMNS || row < 0 || row >= rows()) return -1;
        int index = row * COLUMNS + column;
        return index < PANELS ? index : -1;
    }

    private static double[] cellLocal(int index, double mx, double my) {
        int[] size = windowSize();
        double cw = (double) size[0] / COLUMNS;
        double ch = (double) size[1] / rows();
        return new double[] {mx - (index % COLUMNS) * cw, my - (index / COLUMNS) * ch};
    }

    private static void installCallbacks() {
        GLFW.glfwSetCursorPosCallback(window, (win, mx, my) -> {
            cursorX = mx;
            cursorY = my;
            int index = cellAt(mx, my);
            if (index != hovered && hovered >= 0) ph_plot_pointer_leave(plots[hovered]);
            hovered = index;
            if (index < 0) return;
            double[] local = cellLocal(index, mx, my);
            ph_plot_pointer_move(plots[index], local[0], local[1], PH_MOD_NONE);
        });

        GLFW.glfwSetMouseButtonCallback(window, (win, button, action, mods) -> {
            int index = cellAt(cursorX, cursorY);
            if (index < 0) return;
            double[] local = cellLocal(index, cursorX, cursorY);
            int which = button == GLFW.GLFW_MOUSE_BUTTON_RIGHT ? PH_BUTTON_RIGHT
                      : button == GLFW.GLFW_MOUSE_BUTTON_MIDDLE ? PH_BUTTON_MIDDLE
                      : PH_BUTTON_LEFT;
            if (action == GLFW.GLFW_PRESS) {
                ph_plot_pointer_down(plots[index], local[0], local[1], which, PH_MOD_NONE);
            } else if (action == GLFW.GLFW_RELEASE) {
                ph_plot_pointer_up(plots[index], local[0], local[1], which, PH_MOD_NONE);
            }
        });

        GLFW.glfwSetScrollCallback(window, (win, xoffset, yoffset) -> {
            int index = cellAt(cursorX, cursorY);
            if (index < 0) return;
            double[] local = cellLocal(index, cursorX, cursorY);
            // GLFW counts notches, positive upward. The core follows the
            // browser's WheelEvent.deltaY: positive downward, ~100 per notch.
            ph_plot_wheel(plots[index], local[0], local[1], -yoffset * 100.0, PH_MOD_NONE);
        });

        GLFW.glfwSetKeyCallback(window, (win, key, scancode, action, mods) -> {
            if (action != GLFW.GLFW_PRESS) return;
            switch (key) {
                case GLFW.GLFW_KEY_ESCAPE -> GLFW.glfwSetWindowShouldClose(win, true);
                case GLFW.GLFW_KEY_R -> {
                    for (long plot : plots) ph_plot_reset_view(plot);
                }
                case GLFW.GLFW_KEY_B -> {
                    for (long plot : plots) ph_plot_set_mode(plot, PH_MODE_BOX);
                }
                case GLFW.GLFW_KEY_P -> {
                    for (long plot : plots) ph_plot_set_mode(plot, PH_MODE_PAN);
                }
                case GLFW.GLFW_KEY_T -> {
                    theme = theme == PH_THEME_DARK ? PH_THEME_LIGHT : PH_THEME_DARK;
                    for (long plot : plots) ph_plot_set_theme(plot, theme);
                }
                case GLFW.GLFW_KEY_SPACE -> paused = !paused;
                default -> { }
            }
        });
    }

    private static void drawFrame(Arena frame) {
        int[] logical = windowSize();
        int[] device = framebufferSize();
        if (device[0] <= 0 || device[1] <= 0) return;
        // From the two sizes rather than the content scale: on fractional
        // scaling they disagree, and it is the framebuffer that must win.
        float dpr = logical[0] > 0 ? (float) device[0] / logical[0] : 1.0f;

        double cw = (double) logical[0] / COLUMNS;
        double ch = (double) logical[1] / rows();
        for (int i = 0; i < PANELS; i++) ph_plot_set_size(plots[i], (int) Math.round(cw),
                                                          (int) Math.round(ch));

        MemorySegment target = ph_frame_target.allocate(frame);
        for (int i = 0; i < PANELS; i++) {
            int column = i % COLUMNS;
            int row = i / COLUMNS;
            ph_frame_target_init(target);
            int x = (int) Math.round(column * cw * dpr);
            int right = (int) Math.round((column + 1) * cw * dpr);
            int top = (int) Math.round(row * ch * dpr);
            int bottom = (int) Math.round((row + 1) * ch * dpr);

            target.set(ValueLayout.JAVA_INT, ph_frame_target.OFFSET_FRAMEBUFFER, 0);
            target.set(ValueLayout.JAVA_INT, ph_frame_target.OFFSET_X, x);
            target.set(ValueLayout.JAVA_INT, ph_frame_target.OFFSET_WIDTH, right - x);
            // GL's origin is bottom-left, so the top row of cells is the high y.
            target.set(ValueLayout.JAVA_INT, ph_frame_target.OFFSET_Y, device[1] - bottom);
            target.set(ValueLayout.JAVA_INT, ph_frame_target.OFFSET_HEIGHT, bottom - top);
            target.set(ValueLayout.JAVA_FLOAT, ph_frame_target.OFFSET_DPR, dpr);

            if (ph_plot_render(plots[i], target) != PH_OK) {
                throw new IllegalStateException("render: " + Photon.lastError());
            }
        }
    }

    /**
     * Render every panel through ph_plot_render_pixels and write a PNG.
     *
     * The same `--grab` the Qt galleries have, and for the same reason: the
     * comparison against the web gallery should be an image diff rather than a
     * squint. It also needs no GL beyond the context — the readback path is
     * what JavaFX and WPF would use, so exercising it here is free coverage.
     */
    private static void grab(String path, Arena frame) throws Exception {
        int cellWidth = 640;
        int cellHeight = 420;
        int stride = cellWidth * 4;
        MemorySegment pixels = frame.allocate((long) stride * cellHeight);
        BufferedImage sheet = new BufferedImage(cellWidth * COLUMNS, cellHeight * rows(),
                                                BufferedImage.TYPE_INT_ARGB);
        for (int i = 0; i < PANELS; i++) {
            ph_plot_set_size(plots[i], cellWidth, cellHeight);
            int result = ph_plot_render_pixels(plots[i], cellWidth, cellHeight, 1.0f, pixels,
                                               stride);
            if (result != PH_OK) throw new IllegalStateException(Photon.lastError());
            int ox = (i % COLUMNS) * cellWidth;
            int oy = (i / COLUMNS) * cellHeight;
            for (int y = 0; y < cellHeight; y++) {
                for (int x = 0; x < cellWidth; x++) {
                    long at = (long) y * stride + (long) x * 4;
                    int r = pixels.get(ValueLayout.JAVA_BYTE, at) & 0xFF;
                    int g = pixels.get(ValueLayout.JAVA_BYTE, at + 1) & 0xFF;
                    int b = pixels.get(ValueLayout.JAVA_BYTE, at + 2) & 0xFF;
                    int a = pixels.get(ValueLayout.JAVA_BYTE, at + 3) & 0xFF;
                    sheet.setRGB(ox + x, oy + y, (a << 24) | (r << 16) | (g << 8) | b);
                }
            }
        }
        ImageIO.write(sheet, "png", new java.io.File(path));
        System.out.println("wrote " + path + " " + sheet.getWidth() + "x" + sheet.getHeight());
    }

    public static void main(String[] args) throws Exception {
        GLFWErrorCallback.createPrint(System.err).set();
        if (!GLFW.glfwInit()) throw new IllegalStateException("could not initialize GLFW");

        GLFW.glfwWindowHint(GLFW.GLFW_CONTEXT_VERSION_MAJOR, 3);
        GLFW.glfwWindowHint(GLFW.GLFW_CONTEXT_VERSION_MINOR, 3);
        GLFW.glfwWindowHint(GLFW.GLFW_OPENGL_PROFILE, GLFW.GLFW_OPENGL_CORE_PROFILE);
        GLFW.glfwWindowHint(GLFW.GLFW_OPENGL_FORWARD_COMPAT, GLFW.GLFW_TRUE);
        GLFW.glfwWindowHint(GLFW.GLFW_SCALE_TO_MONITOR, GLFW.GLFW_TRUE);

        window = GLFW.glfwCreateWindow(1280, 800, "Photon — Java gallery", 0L, 0L);
        if (window == 0L) throw new IllegalStateException("could not create a GL 3.3 core window");
        GLFW.glfwMakeContextCurrent(window);
        GLFW.glfwSwapInterval(1);

        MemorySegment host = ph_host_desc.allocate(ARENA);
        ph_host_desc_init(host);
        host.set(ValueLayout.JAVA_INT, ph_host_desc.OFFSET_API, PH_GFX_GL33);
        host.set(ValueLayout.ADDRESS, ph_host_desc.OFFSET_GET_PROC_ADDRESS, resolveGlStub());
        if (ph_init(ABI_VERSION, host) != PH_OK) {
            throw new IllegalStateException("ph_init: " + Photon.lastError());
        }

        for (int i = 0; i < PANELS; i++) plots[i] = create("#0f172a");
        buildWaves(plots[0]);
        buildDecay(plots[1]);
        buildScatter(plots[2]);
        buildStream(plots[3]);
        buildRevenue(plots[4]);
        buildFunnel(plots[5]);
        buildShare(plots[6]);
        buildImpulse(plots[7]);
        buildYield(plots[8]);
        buildLatency(plots[9]);
        buildField(plots[10]);
        buildSprite(plots[11]);
        Sessions bars = sessions();
        buildCandles(plots[12], bars);
        buildBars(plots[13], bars);
        buildDensity(plots[14]);
        buildFlow(plots[15]);
        buildContour(plots[16]);
        buildNetwork(plots[17]);
        buildSignals(plots[18], bars);
        buildFit(plots[19]);
        buildSpectrum(plots[20]);
        buildRoc(plots[21]);
        buildEmbedding(plots[22]);
        buildTreemap(plots[23]);
        buildSunburst(plots[24]);
        buildSankey(plots[25]);
        buildChord(plots[26]);
        buildGauge(plots[27]);
        buildParallel(plots[28]);
        buildGrouped(plots[29]);
        buildStacked(plots[30]);
        buildHistogram(plots[31]);
        buildSpectrogram(plots[32]);
        buildPolar(plots[33]);

        installCallbacks();

        // `--frames N` renders N frames and exits, so the gallery can be run in
        // a check rather than only by hand.
        int limit = -1;
        String grabPath = null;
        for (int i = 0; i + 1 < args.length; i++) {
            if (args[i].equals("--frames")) limit = Integer.parseInt(args[i + 1]);
            if (args[i].equals("--grab")) grabPath = args[i + 1];
        }

        if (grabPath != null) {
            try (Arena frame = Arena.ofConfined()) {
                advanceStream(1.7);  // a fixed phase, so the image is reproducible
                grab(grabPath, frame);
            }
            ph_shutdown();
            GLFW.glfwDestroyWindow(window);
            GLFW.glfwTerminate();
            ARENA.close();
            return;
        }

        try (Arena frame = Arena.ofConfined()) {
            MemorySegment event = ph_event.allocate(frame);
            long drawn = 0;
            while (!GLFW.glfwWindowShouldClose(window) && (limit < 0 || drawn < limit)) {
                if (!paused) advanceStream(GLFW.glfwGetTime());
                drawFrame(frame);
                GLFW.glfwSwapBuffers(window);
                drawn++;

                for (long plot : plots) {
                    while (ph_plot_poll_event(plot, event) == PH_OK
                           && event.get(ValueLayout.JAVA_INT, ph_event.OFFSET_TYPE)
                              != PH_EVENT_NONE) {
                        // Drained so the queue cannot grow; this host redraws
                        // every frame anyway, so nothing here needs acting on.
                    }
                }
                GLFW.glfwPollEvents();
            }
            if (limit >= 0) System.out.println("rendered " + drawn + " frames");
        }

        ph_shutdown();
        GLFW.glfwDestroyWindow(window);
        GLFW.glfwTerminate();
        ARENA.close();
    }
}
