import static photon.Photon.*;

import java.lang.foreign.Arena;
import java.lang.foreign.MemorySegment;
import java.lang.foreign.ValueLayout;
import photon.Photon;

/**
 * Every entry point in the ABI, called once, from the marshalled side.
 *
 * The C tests check the ABI as C sees it, which is the easy direction: the
 * compiler has the header. This checks the direction where things actually go
 * wrong — a struct field at the wrong offset, a handle truncated to 32 bits, a
 * string that never made it to UTF-8. None of those are compile errors in Java,
 * and most of them do not crash either; they produce a plausible number.
 *
 * It runs headless, with no GL context, so the two rendering calls are expected
 * to fail — and the assertion is that they fail *honestly*, naming what is
 * missing rather than returning a generic error or, worse, succeeding.
 *
 *   javac -d out bindings/java/photon/Photon.java bindings/java/PhotonSmokeTest.java
 *   java -Dphoton.library=build/debug/lib/libphoton.so -cp out PhotonSmokeTest
 */
public final class PhotonSmokeTest {

    private static int failures = 0;
    private static final java.util.Set<String> called = new java.util.TreeSet<>();

    static void check(boolean condition, String what) {
        if (!condition) {
            System.out.println("  FAIL " + what);
            failures++;
        }
    }

    static void checkEq(long actual, long expected, String what) {
        check(actual == expected, what + " (got " + actual + ", want " + expected + ")");
    }

    /** Note that an entry point has been exercised, so the tally at the end is real. */
    static void ran(String... names) {
        for (String name : names) called.add(name);
    }

    static MemorySegment utf8(Arena arena, String text) {
        return arena.allocateFrom(text);
    }

    /**
     * Print and flush.
     *
     * The flush is not decoration. Under ctest stdout is a pipe, so it is
     * block-buffered, and a native crash takes the buffer with it — which makes
     * the last line you see arbitrarily earlier than the last line that ran.
     * A Windows-only crash was first reported four sections later than it
     * actually happened because of exactly this.
     */
    static void step(String name) {
        System.out.println(name);
        System.out.flush();
    }

    // ---- the tests ---------------------------------------------------------

    static void versionAndInit(Arena arena) {
        checkEq(ph_abi_version(), ABI_VERSION, "ph_abi_version");

        MemorySegment major = arena.allocate(ValueLayout.JAVA_INT);
        MemorySegment minor = arena.allocate(ValueLayout.JAVA_INT);
        MemorySegment patch = arena.allocate(ValueLayout.JAVA_INT);
        ph_version(major, minor, patch);
        check(major.get(ValueLayout.JAVA_INT, 0) >= 0, "ph_version major");

        // A wrong ABI version is refused before anything else happens.
        checkEq(ph_init(ABI_VERSION + 1, MemorySegment.NULL), PH_E_ABI_MISMATCH, "ph_init mismatch");
        check(Photon.lastError().contains("ABI"), "ph_last_error names the mismatch");

        MemorySegment host = ph_host_desc.allocate(arena);
        ph_host_desc_init(host);
        checkEq(host.get(ValueLayout.JAVA_INT, ph_host_desc.OFFSET_STRUCT_SIZE),
                ph_host_desc.SIZE, "ph_host_desc_init fills struct_size");
        checkEq(ph_init(ABI_VERSION, host), PH_OK, "ph_init");

        ran("ph_abi_version", "ph_version", "ph_init", "ph_last_error", "ph_host_desc_init");
    }

    /** The zero-means-defaults rule, checked from the side that relies on it. */
    static void descriptorDefaults(Arena arena) {
        MemorySegment plotDesc = ph_plot_desc.allocate(arena);
        ph_plot_desc_init(plotDesc);
        checkEq(plotDesc.get(ValueLayout.JAVA_INT, ph_plot_desc.OFFSET_WIDTH), 640, "default width");
        checkEq(plotDesc.get(ValueLayout.JAVA_INT, ph_plot_desc.OFFSET_HEIGHT), 400, "default height");
        // Interaction, hover, crosshair and the colorbar are on by default, which
        // is why the descriptor spells them negatively — so these stay zero.
        checkEq(plotDesc.get(ValueLayout.JAVA_INT, ph_plot_desc.OFFSET_NO_INTERACTION), 0,
                "no_interaction defaults off");

        MemorySegment line = ph_line_desc.allocate(arena);
        ph_line_desc_init(line);
        check(line.get(ValueLayout.JAVA_FLOAT, ph_line_desc.OFFSET_WIDTH) == 1.5f,
              "default line width");
        checkEq(line.get(ValueLayout.JAVA_INT, ph_line_desc.OFFSET_JOIN), PH_JOIN_ROUND,
                "default join");

        MemorySegment scatter = ph_scatter_desc.allocate(arena);
        ph_scatter_desc_init(scatter);
        check(scatter.get(ValueLayout.JAVA_FLOAT, ph_scatter_desc.OFFSET_SIZE) > 0.0f,
              "default marker size");

        MemorySegment axis = ph_axis_desc.allocate(arena);
        ph_axis_desc_init(axis);
        checkEq(axis.get(ValueLayout.JAVA_INT, ph_axis_desc.OFFSET_TYPE), PH_SCALE_LINEAR,
                "default scale type");

        MemorySegment axisConfig = ph_axis_config.allocate(arena);
        ph_axis_config_init(axisConfig);
        checkEq(axisConfig.get(ValueLayout.JAVA_INT, ph_axis_config.OFFSET_STRUCT_SIZE),
                ph_axis_config.SIZE, "ph_axis_config_init fills struct_size");

        MemorySegment target = ph_frame_target.allocate(arena);
        ph_frame_target_init(target);
        checkEq(target.get(ValueLayout.JAVA_INT, ph_frame_target.OFFSET_STRUCT_SIZE),
                ph_frame_target.SIZE, "ph_frame_target_init fills struct_size");

        ran("ph_plot_desc_init", "ph_line_desc_init", "ph_scatter_desc_init", "ph_axis_desc_init",
            "ph_axis_config_init", "ph_frame_target_init");
    }

    static void colors(Arena arena) {
        MemorySegment out = arena.allocate(ValueLayout.JAVA_INT);
        checkEq(ph_color_parse(utf8(arena, "#4f9cff"), out), PH_OK, "ph_color_parse");
        // 0xRRGGBBAA, so the alpha byte is the low one and Java sees it signed.
        checkEq(out.get(ValueLayout.JAVA_INT, 0) & 0xFFFFFFFFL, 0x4f9cffffL, "parsed colour");
        checkEq(ph_color_parse(utf8(arena, "not a colour"), out), PH_E_UNSUPPORTED,
                "ph_color_parse rejects a name");
        ran("ph_color_parse");
    }

    /** The colormap and palette registries, and the maths over them. */
    static void colormaps(Arena arena) {
        MemorySegment spec = ph_colormap_spec.allocate(arena);
        ph_colormap_spec_init(spec);
        MemorySegment out = arena.allocate(ValueLayout.JAVA_INT);

        // A NULL name is viridis, whose ends are the dark purple and the yellow
        // every plot of it opens and closes on.
        checkEq(ph_colormap_sample(spec, 0.0, out), PH_OK, "ph_colormap_sample");
        long low = out.get(ValueLayout.JAVA_INT, 0) & 0xFFFFFFFFL;
        checkEq(ph_colormap_sample(spec, 1.0, out), PH_OK, "ph_colormap_sample(1)");
        long high = out.get(ValueLayout.JAVA_INT, 0) & 0xFFFFFFFFL;
        check(low == 0x440154ffL, "viridis starts dark purple");
        check(high == 0xfde725ffL, "viridis ends yellow");

        // Reversing swaps the ends, which is the whole of what it promises.
        spec.set(ValueLayout.JAVA_INT, ph_colormap_spec.OFFSET_REVERSE, 1);
        checkEq(ph_colormap_sample(spec, 0.0, out), PH_OK, "reversed sample");
        check((out.get(ValueLayout.JAVA_INT, 0) & 0xFFFFFFFFL) == high, "reverse swaps the ends");
        spec.set(ValueLayout.JAVA_INT, ph_colormap_spec.OFFSET_REVERSE, 0);

        // Two inline stops: black to white, so the midpoint is grey and the
        // arithmetic is checkable by eye as well as by assertion.
        MemorySegment stops = arena.allocate(ValueLayout.JAVA_INT, 2);
        stops.setAtIndex(ValueLayout.JAVA_INT, 0, 0x000000FF);
        stops.setAtIndex(ValueLayout.JAVA_INT, 1, 0xFFFFFFFF);
        spec.set(ValueLayout.ADDRESS, ph_colormap_spec.OFFSET_STOPS, stops);
        spec.set(ValueLayout.JAVA_INT, ph_colormap_spec.OFFSET_STOP_COUNT, 2);
        checkEq(ph_colormap_sample(spec, 0.5, out), PH_OK, "inline stops");
        int grey = (out.get(ValueLayout.JAVA_INT, 0) >>> 24) & 0xFF;
        check(grey >= 126 && grey <= 129, "the midpoint of black..white is grey");

        checkEq(ph_colormap_register(utf8(arena, "smoke"), stops, 2), PH_OK,
                "ph_colormap_register");
        checkEq(ph_colormap_register(utf8(arena, "too-short"), stops, 1), PH_E_INVALID_ARGUMENT,
                "one stop is not a colormap");

        int count = ph_colormap_count();
        check(count >= 13, "twelve built-ins plus the registered one");
        check(Photon.string(ph_colormap_name(0)).equals("viridis"), "viridis is first");
        check(ph_colormap_name(count).equals(MemorySegment.NULL), "out of range gives null");
        boolean found = false;
        for (int i = 0; i < count; i++) {
            if (Photon.string(ph_colormap_name(i)).equals("smoke")) found = true;
        }
        check(found, "a registered colormap is listed");

        // A symmetric domain has to reach the furthest value on either side, or
        // a diverging map's neutral midpoint drifts off the reference.
        MemorySegment values = arena.allocate(ValueLayout.JAVA_DOUBLE, 3);
        values.setAtIndex(ValueLayout.JAVA_DOUBLE, 0, -2.0);
        values.setAtIndex(ValueLayout.JAVA_DOUBLE, 1, 1.0);
        values.setAtIndex(ValueLayout.JAVA_DOUBLE, 2, 7.0);
        MemorySegment range = ph_range.allocate(arena);
        checkEq(ph_symmetric_domain(values, 3, 0.0, range), PH_OK, "ph_symmetric_domain");
        check(range.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO) == -7.0, "domain lo");
        check(range.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) == 7.0, "domain hi");

        check(ph_palette_count() >= 4, "four built-in palettes");
        check(Photon.string(ph_palette_name(0)).equals("tableau10"), "tableau10 is first");
        check(ph_palette_name(-1).equals(MemorySegment.NULL), "a negative index gives null");
        long first = ph_palette_color(utf8(arena, "tableau10"), 0) & 0xFFFFFFFFL;
        check(first == 0x4e79a7ffL, "tableau10 starts blue");
        // Cycling, not clamping: the eleventh colour of a ten-colour palette is
        // the first one again.
        check((ph_palette_color(utf8(arena, "tableau10"), 10) & 0xFFFFFFFFL) == first,
              "a palette cycles");
        check((ph_palette_color(utf8(arena, "tableau10"), -1) & 0xFFFFFFFFL)
              == (ph_palette_color(utf8(arena, "tableau10"), 9) & 0xFFFFFFFFL),
              "and cycles backwards too");
        check((ph_palette_color(MemorySegment.NULL, 0) & 0xFFFFFFFFL) == first,
              "a null name is tableau10");

        MemorySegment colors = arena.allocate(ValueLayout.JAVA_INT, 1);
        colors.setAtIndex(ValueLayout.JAVA_INT, 0, 0x123456FF);
        checkEq(ph_palette_register(utf8(arena, "smoke"), colors, 1), PH_OK,
                "ph_palette_register");
        check((ph_palette_color(utf8(arena, "smoke"), 3) & 0xFFFFFFFFL) == 0x123456ffL,
              "a one-colour palette gives that colour for every index");

        ran("ph_colormap_spec_init", "ph_colormap_register", "ph_colormap_sample",
            "ph_colormap_count", "ph_colormap_name", "ph_symmetric_domain",
            "ph_palette_register", "ph_palette_count", "ph_palette_name", "ph_palette_color");
    }

    /** A plot, a line, a scatter, and every axis and view call over them. */
    static long buildPlot(Arena arena) {
        MemorySegment desc = ph_plot_desc.allocate(arena);
        ph_plot_desc_init(desc);
        desc.set(ValueLayout.JAVA_INT, ph_plot_desc.OFFSET_WIDTH, 800);
        desc.set(ValueLayout.JAVA_INT, ph_plot_desc.OFFSET_HEIGHT, 600);

        MemorySegment handle = arena.allocate(ValueLayout.JAVA_LONG);
        checkEq(ph_plot_create(desc, handle), PH_OK, "ph_plot_create");
        long plot = handle.get(ValueLayout.JAVA_LONG, 0);
        check(plot != PH_NULL_HANDLE, "a live plot handle");
        checkEq(ph_plot_valid(plot), 1, "ph_plot_valid");

        checkEq(ph_plot_set_size(plot, 640, 480), PH_OK, "ph_plot_set_size");
        checkEq(ph_plot_set_theme(plot, PH_THEME_LIGHT), PH_OK, "ph_plot_set_theme");
        checkEq(ph_plot_set_title(plot, utf8(arena, "Portföy · σ")), PH_OK, "ph_plot_set_title");
        checkEq(ph_plot_set_title(plot, MemorySegment.NULL), PH_OK, "ph_plot_set_title(null)");
        // On by default; a plot with no colour-mapping layer reserves nothing
        // for it either way, so this is only the switch being wired.
        checkEq(ph_plot_set_colorbar(plot, 0), PH_OK, "ph_plot_set_colorbar");
        checkEq(ph_plot_set_colorbar(plot, 1), PH_OK, "ph_plot_set_colorbar(on)");
        checkEq(ph_plot_set_tooltip(plot, 0), PH_OK, "ph_plot_set_tooltip");
        checkEq(ph_plot_set_tooltip(plot, 1), PH_OK, "ph_plot_set_tooltip(on)");
        checkEq(ph_plot_set_pick_mode(plot, PH_PICK_XY), PH_OK, "ph_plot_set_pick_mode");
        checkEq(ph_plot_set_pick_mode(plot, 99), PH_E_INVALID_ARGUMENT, "an unknown pick mode");
        checkEq(ph_plot_set_pick_mode(plot, PH_PICK_X), PH_OK, "back to the default");

        MemorySegment legend = ph_legend_config.allocate(arena);
        ph_legend_config_init(legend);
        legend.set(ValueLayout.JAVA_INT, ph_legend_config.OFFSET_ENABLED, 1);
        legend.set(ValueLayout.JAVA_INT, ph_legend_config.OFFSET_POSITION, PH_LEGEND_BOTTOM_LEFT);
        checkEq(ph_plot_set_legend(plot, legend), PH_OK, "ph_plot_set_legend");
        legend.set(ValueLayout.JAVA_INT, ph_legend_config.OFFSET_POSITION, 42);
        checkEq(ph_plot_set_legend(plot, legend), PH_E_INVALID_ARGUMENT,
                "an unknown legend position");
        checkEq(ph_plot_set_legend(plot, MemorySegment.NULL), PH_OK,
                "a null config restores the defaults");

        MemorySegment margin = ph_margin.allocate(arena);
        margin.set(ValueLayout.JAVA_FLOAT, ph_margin.OFFSET_TOP, 20.0f);
        margin.set(ValueLayout.JAVA_FLOAT, ph_margin.OFFSET_RIGHT, 20.0f);
        margin.set(ValueLayout.JAVA_FLOAT, ph_margin.OFFSET_BOTTOM, 44.0f);
        margin.set(ValueLayout.JAVA_FLOAT, ph_margin.OFFSET_LEFT, 60.0f);
        checkEq(ph_plot_set_margin(plot, margin), PH_OK, "ph_plot_set_margin");

        ran("ph_plot_create", "ph_plot_valid", "ph_plot_set_size", "ph_plot_set_theme",
            "ph_plot_set_title", "ph_plot_set_margin", "ph_plot_set_colorbar",
            "ph_plot_set_pick_mode", "ph_plot_set_tooltip", "ph_legend_config_init",
            "ph_plot_set_legend");
        return plot;
    }

    static void axes(Arena arena, long plot) {
        MemorySegment x = utf8(arena, "x");
        MemorySegment y = utf8(arena, "y");

        MemorySegment axis = ph_axis_desc.allocate(arena);
        ph_axis_desc_init(axis);
        axis.set(ValueLayout.JAVA_INT, ph_axis_desc.OFFSET_TYPE, PH_SCALE_LOG);
        checkEq(ph_plot_set_scale(plot, y, axis), PH_OK, "ph_plot_set_scale");
        checkEq(ph_plot_set_scale(plot, utf8(arena, "nope"), axis), PH_E_INVALID_ARGUMENT,
                "ph_plot_set_scale rejects an unknown axis");

        // ph_range crosses by value, which is the marshalling most likely to be
        // silently wrong: two doubles in one struct argument.
        MemorySegment domain = ph_range.allocate(arena);
        domain.set(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO, 1.0);
        domain.set(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI, 1000.0);
        checkEq(ph_plot_set_domain(plot, y, domain), PH_OK, "ph_plot_set_domain");

        MemorySegment readBack = ph_range.allocate(arena);
        checkEq(ph_plot_get_domain(plot, y, readBack), PH_OK, "ph_plot_get_domain");
        check(readBack.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO) == 1.0,
              "the domain survived the round trip (lo)");
        check(readBack.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) == 1000.0,
              "the domain survived the round trip (hi)");

        // An unrepresentable view is refused, and says so.
        domain.set(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI, Double.POSITIVE_INFINITY);
        checkEq(ph_plot_set_domain(plot, x, domain), PH_E_INVALID_ARGUMENT,
                "an infinite domain is refused");

        MemorySegment secondary = utf8(arena, "volume");
        ph_axis_desc_init(axis);
        checkEq(ph_plot_add_y_axis(plot, secondary, axis, 1), PH_OK, "ph_plot_add_y_axis");
        checkEq(ph_plot_add_y_axis(plot, secondary, axis, 1), PH_E_INVALID_ARGUMENT,
                "a duplicate axis id is refused");
        checkEq(ph_plot_remove_y_axis(plot, secondary), PH_OK, "ph_plot_remove_y_axis");

        MemorySegment config = ph_axis_config.allocate(arena);
        ph_axis_config_init(config);
        config.set(ValueLayout.ADDRESS, ph_axis_config.OFFSET_TITLE, utf8(arena, "time (s)"));
        config.set(ValueLayout.JAVA_INT, ph_axis_config.OFFSET_MINOR_TICKS, 4);
        checkEq(ph_plot_set_axis_config(plot, x, config), PH_OK, "ph_plot_set_axis_config");
        checkEq(ph_plot_set_axis_config(plot, x, MemorySegment.NULL), PH_OK,
                "a null config restores the theme defaults");

        // An array of ph_tick, which is the only place the ABI takes one.
        MemorySegment ticks = arena.allocate(ph_tick.LAYOUT, 3);
        for (int i = 0; i < 3; i++) {
            long base = i * ph_tick.SIZE;
            ticks.set(ValueLayout.JAVA_DOUBLE, base + ph_tick.OFFSET_VALUE, i * 0.5);
            ticks.set(ValueLayout.ADDRESS, base + ph_tick.OFFSET_LABEL, MemorySegment.NULL);
            ticks.set(ValueLayout.JAVA_INT, base + ph_tick.OFFSET_MINOR, 0);
            ticks.set(ValueLayout.JAVA_INT, base + ph_tick.OFFSET_GRID, PH_TOGGLE_DEFAULT);
        }
        ticks.set(ValueLayout.ADDRESS, ph_tick.OFFSET_LABEL, utf8(arena, "origin"));
        checkEq(ph_plot_set_axis_ticks(plot, x, ticks, 3), PH_OK, "ph_plot_set_axis_ticks");
        checkEq(ph_plot_set_axis_ticks(plot, x, MemorySegment.NULL, 0), PH_OK,
                "count 0 restores automatic ticks");

        checkEq(ph_plot_autoscale(plot), PH_OK, "ph_plot_autoscale");
        checkEq(ph_plot_reset_view(plot), PH_OK, "ph_plot_reset_view");

        ran("ph_plot_set_scale", "ph_plot_set_domain", "ph_plot_get_domain", "ph_plot_add_y_axis",
            "ph_plot_remove_y_axis", "ph_plot_set_axis_config", "ph_plot_set_axis_ticks",
            "ph_plot_autoscale", "ph_plot_reset_view");
    }

    static long layers(Arena arena, long plot) {
        int count = 64;
        MemorySegment xs = arena.allocate(ValueLayout.JAVA_DOUBLE, count);
        MemorySegment ys = arena.allocate(ValueLayout.JAVA_DOUBLE, count);
        for (int i = 0; i < count; i++) {
            xs.setAtIndex(ValueLayout.JAVA_DOUBLE, i, i);
            ys.setAtIndex(ValueLayout.JAVA_DOUBLE, i, Math.sin(i * 0.2) * 10.0);
        }

        MemorySegment desc = ph_line_desc.allocate(arena);
        ph_line_desc_init(desc);
        desc.set(ValueLayout.ADDRESS, ph_line_desc.OFFSET_X, xs);
        desc.set(ValueLayout.ADDRESS, ph_line_desc.OFFSET_Y, ys);
        desc.set(ValueLayout.JAVA_INT, ph_line_desc.OFFSET_COUNT, count);
        desc.set(ValueLayout.JAVA_INT, ph_line_desc.OFFSET_COLOR, 0x38bdf8ff);
        desc.set(ValueLayout.ADDRESS, ph_line_desc.OFFSET_NAME, utf8(arena, "sin"));

        MemorySegment handle = arena.allocate(ValueLayout.JAVA_LONG);
        checkEq(ph_plot_add_line(plot, desc, handle), PH_OK, "ph_plot_add_line");
        long line = handle.get(ValueLayout.JAVA_LONG, 0);
        checkEq(ph_layer_valid(line), 1, "ph_layer_valid");

        // The bounds prove the arrays crossed intact: 64 points, x 0..63.
        MemorySegment bx = ph_range.allocate(arena);
        MemorySegment by = ph_range.allocate(arena);
        checkEq(ph_layer_bounds(line, bx, by), PH_OK, "ph_layer_bounds");
        check(bx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO) == 0.0, "x bounds lo");
        check(bx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) == 63.0, "x bounds hi");
        check(by.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) <= 10.0, "y bounds hi");

        MemorySegment scatterDesc = ph_scatter_desc.allocate(arena);
        ph_scatter_desc_init(scatterDesc);
        scatterDesc.set(ValueLayout.ADDRESS, ph_scatter_desc.OFFSET_X, xs);
        scatterDesc.set(ValueLayout.ADDRESS, ph_scatter_desc.OFFSET_Y, ys);
        scatterDesc.set(ValueLayout.JAVA_INT, ph_scatter_desc.OFFSET_COUNT, count);
        scatterDesc.set(ValueLayout.JAVA_INT, ph_scatter_desc.OFFSET_MARKER, PH_MARKER_DIAMOND);
        MemorySegment scatterHandle = arena.allocate(ValueLayout.JAVA_LONG);
        checkEq(ph_plot_add_scatter(plot, scatterDesc, scatterHandle), PH_OK,
                "ph_plot_add_scatter");
        long scatter = scatterHandle.get(ValueLayout.JAVA_LONG, 0);

        // Colouring by value used to be rejected outright, because accepting it
        // and drawing one flat colour is the blank-chart failure by another
        // name. The colormaps exist now, so it is a normal request.
        MemorySegment mapped = ph_scatter_desc.allocate(arena);
        ph_scatter_desc_init(mapped);
        mapped.set(ValueLayout.ADDRESS, ph_scatter_desc.OFFSET_X, xs);
        mapped.set(ValueLayout.ADDRESS, ph_scatter_desc.OFFSET_Y, ys);
        mapped.set(ValueLayout.JAVA_INT, ph_scatter_desc.OFFSET_COUNT, count);
        mapped.set(ValueLayout.ADDRESS, ph_scatter_desc.OFFSET_COLOR_BY, ys);
        checkEq(ph_plot_add_scatter(plot, mapped, scatterHandle), PH_OK,
                "a scatter coloured by value");
        long mappedLayer = scatterHandle.get(ValueLayout.JAVA_LONG, 0);
        checkEq(ph_layer_bounds(mappedLayer, bx, by), PH_OK, "colour mapping does not move it");
        checkEq(ph_layer_destroy(mappedLayer), PH_OK, "the mapped layer is destroyed");

        // Streaming: replace the data in place.
        for (int i = 0; i < count; i++) {
            ys.setAtIndex(ValueLayout.JAVA_DOUBLE, i, Math.cos(i * 0.2) * 5.0);
        }
        checkEq(ph_layer_set_xy(line, xs, ys, count), PH_OK, "ph_layer_set_xy");
        checkEq(ph_layer_bounds(line, bx, by), PH_OK, "bounds after streaming");
        check(by.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) <= 5.0,
              "the new data replaced the old");

        checkEq(ph_layer_set_visible(scatter, 0), PH_OK, "ph_layer_set_visible");
        checkEq(ph_layer_destroy(scatter), PH_OK, "ph_layer_destroy");
        checkEq(ph_layer_valid(scatter), 0, "a destroyed layer handle is dead");

        ran("ph_plot_add_line", "ph_plot_add_scatter", "ph_layer_valid", "ph_layer_bounds",
            "ph_layer_set_xy", "ph_layer_set_visible", "ph_layer_destroy");
        return line;
    }

    /** An area band and a bar chart over the same samples. */
    static void areaAndBars(Arena arena, long plot) {
        final int count = 8;
        MemorySegment xs = arena.allocate(ValueLayout.JAVA_DOUBLE, count);
        MemorySegment ys = arena.allocate(ValueLayout.JAVA_DOUBLE, count);
        for (int i = 0; i < count; i++) {
            xs.setAtIndex(ValueLayout.JAVA_DOUBLE, i, i);
            ys.setAtIndex(ValueLayout.JAVA_DOUBLE, i, 10.0 + i);
        }
        MemorySegment handle = arena.allocate(ValueLayout.JAVA_LONG);
        MemorySegment bx = ph_range.allocate(arena);
        MemorySegment by = ph_range.allocate(arena);

        MemorySegment area = ph_area_desc.allocate(arena);
        ph_area_desc_init(area);
        area.set(ValueLayout.ADDRESS, ph_area_desc.OFFSET_X, xs);
        area.set(ValueLayout.ADDRESS, ph_area_desc.OFFSET_Y, ys);
        area.set(ValueLayout.JAVA_INT, ph_area_desc.OFFSET_COUNT, count);
        area.set(ValueLayout.JAVA_DOUBLE, ph_area_desc.OFFSET_BASE_VALUE, 5.0);
        checkEq(ph_plot_add_area(plot, area, handle), PH_OK, "ph_plot_add_area");
        long areaLayer = handle.get(ValueLayout.JAVA_LONG, 0);
        checkEq(ph_layer_bounds(areaLayer, bx, by), PH_OK, "area bounds");
        // The band runs from the base to the top, so the base is the low end.
        check(by.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO) == 5.0, "area y lo is the base");
        check(by.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) == 17.0, "area y hi");

        MemorySegment bar = ph_bar_desc.allocate(arena);
        ph_bar_desc_init(bar);
        bar.set(ValueLayout.ADDRESS, ph_bar_desc.OFFSET_X, xs);
        bar.set(ValueLayout.ADDRESS, ph_bar_desc.OFFSET_Y, ys);
        bar.set(ValueLayout.JAVA_INT, ph_bar_desc.OFFSET_COUNT, count);
        bar.set(ValueLayout.JAVA_DOUBLE, ph_bar_desc.OFFSET_WIDTH, 0.5);
        checkEq(ph_plot_add_bar(plot, bar, handle), PH_OK, "ph_plot_add_bar");
        long barLayer = handle.get(ValueLayout.JAVA_LONG, 0);
        checkEq(ph_layer_bounds(barLayer, bx, by), PH_OK, "bar bounds");
        // Bars are centred on x and half a width wide either side.
        check(bx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO) == -0.25, "bar x lo");
        check(bx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) == 7.25, "bar x hi");

        // Horizontal bars swap which axis carries positions and which values.
        bar.set(ValueLayout.JAVA_INT, ph_bar_desc.OFFSET_ORIENTATION, PH_ORIENT_HORIZONTAL);
        checkEq(ph_plot_add_bar(plot, bar, handle), PH_OK, "horizontal bars");
        checkEq(ph_layer_bounds(handle.get(ValueLayout.JAVA_LONG, 0), bx, by), PH_OK,
                "horizontal bar bounds");
        check(by.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO) == -0.25,
              "the position axis is y now");

        checkEq(ph_layer_destroy(areaLayer), PH_OK, "the area layer is destroyed");
        checkEq(ph_layer_destroy(barLayer), PH_OK, "the bar layer is destroyed");
        checkEq(ph_layer_destroy(handle.get(ValueLayout.JAVA_LONG, 0)), PH_OK, "and the second");

        ran("ph_area_desc_init", "ph_bar_desc_init", "ph_plot_add_area", "ph_plot_add_bar");
    }

    /** A donut and a lollipop chart. */
    static void pieAndStem(Arena arena, long plot) {
        MemorySegment values = arena.allocate(ValueLayout.JAVA_DOUBLE, 4);
        for (int i = 0; i < 4; i++) values.setAtIndex(ValueLayout.JAVA_DOUBLE, i, i + 1);

        MemorySegment pie = ph_pie_desc.allocate(arena);
        ph_pie_desc_init(pie);
        pie.set(ValueLayout.ADDRESS, ph_pie_desc.OFFSET_VALUES, values);
        pie.set(ValueLayout.JAVA_INT, ph_pie_desc.OFFSET_COUNT, 4);
        pie.set(ValueLayout.JAVA_DOUBLE, ph_pie_desc.OFFSET_RADIUS, 2.0);
        pie.set(ValueLayout.JAVA_DOUBLE, ph_pie_desc.OFFSET_INNER_RADIUS, 1.0);
        MemorySegment handle = arena.allocate(ValueLayout.JAVA_LONG);
        checkEq(ph_plot_add_pie(plot, pie, handle), PH_OK, "ph_plot_add_pie");
        long pieLayer = handle.get(ValueLayout.JAVA_LONG, 0);

        MemorySegment bx = ph_range.allocate(arena);
        MemorySegment by = ph_range.allocate(arena);
        checkEq(ph_layer_bounds(pieLayer, bx, by), PH_OK, "pie bounds");
        // The bounds are the circle's box, whatever the slices are.
        check(bx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO) == -2.0, "pie x lo");
        check(by.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) == 2.0, "pie y hi");

        MemorySegment xs = arena.allocate(ValueLayout.JAVA_DOUBLE, 5);
        MemorySegment ys = arena.allocate(ValueLayout.JAVA_DOUBLE, 5);
        for (int i = 0; i < 5; i++) {
            xs.setAtIndex(ValueLayout.JAVA_DOUBLE, i, i);
            ys.setAtIndex(ValueLayout.JAVA_DOUBLE, i, 3.0 - i);
        }
        MemorySegment stem = ph_stem_desc.allocate(arena);
        ph_stem_desc_init(stem);
        stem.set(ValueLayout.ADDRESS, ph_stem_desc.OFFSET_X, xs);
        stem.set(ValueLayout.ADDRESS, ph_stem_desc.OFFSET_Y, ys);
        stem.set(ValueLayout.JAVA_INT, ph_stem_desc.OFFSET_COUNT, 5);
        checkEq(ph_plot_add_stem(plot, stem, handle), PH_OK, "ph_plot_add_stem");
        long stemLayer = handle.get(ValueLayout.JAVA_LONG, 0);
        checkEq(ph_layer_bounds(stemLayer, bx, by), PH_OK, "stem bounds");
        // y runs 3 down to -1, and the baseline at 0 is inside that, so it does
        // not widen the range — but a stem's bounds must include it regardless.
        check(by.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO) == -1.0, "stem y lo");
        check(by.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) == 3.0, "stem y hi");

        checkEq(ph_layer_destroy(pieLayer), PH_OK, "the pie layer is destroyed");
        checkEq(ph_layer_destroy(stemLayer), PH_OK, "the stem layer is destroyed");
        ran("ph_pie_desc_init", "ph_stem_desc_init", "ph_plot_add_pie", "ph_plot_add_stem");
    }

    /** Error bars and box plots — the two layers whose bounds are computed. */
    static void errorBarsAndBoxes(Arena arena, long plot) {
        MemorySegment xs = arena.allocate(ValueLayout.JAVA_DOUBLE, 3);
        MemorySegment ys = arena.allocate(ValueLayout.JAVA_DOUBLE, 3);
        for (int i = 0; i < 3; i++) {
            xs.setAtIndex(ValueLayout.JAVA_DOUBLE, i, i);
            ys.setAtIndex(ValueLayout.JAVA_DOUBLE, i, 10.0);
        }
        MemorySegment err = ph_errorbar_desc.allocate(arena);
        ph_errorbar_desc_init(err);
        err.set(ValueLayout.ADDRESS, ph_errorbar_desc.OFFSET_X, xs);
        err.set(ValueLayout.ADDRESS, ph_errorbar_desc.OFFSET_Y, ys);
        err.set(ValueLayout.JAVA_INT, ph_errorbar_desc.OFFSET_COUNT, 3);
        err.set(ValueLayout.JAVA_DOUBLE, ph_errorbar_desc.OFFSET_Y_ERR, 2.0);
        err.set(ValueLayout.JAVA_DOUBLE, ph_errorbar_desc.OFFSET_X_ERR, 0.5);
        MemorySegment handle = arena.allocate(ValueLayout.JAVA_LONG);
        checkEq(ph_plot_add_errorbar(plot, err, handle), PH_OK, "ph_plot_add_errorbar");
        long errLayer = handle.get(ValueLayout.JAVA_LONG, 0);

        MemorySegment bx = ph_range.allocate(arena);
        MemorySegment by = ph_range.allocate(arena);
        checkEq(ph_layer_bounds(errLayer, bx, by), PH_OK, "errorbar bounds");
        // The bounds are the whisker ends, not the points: x runs 0-0.5 to
        // 2+0.5 and y is 10 plus or minus 2 for every point.
        check(bx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO) == -0.5, "errorbar x lo");
        check(bx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) == 2.5, "errorbar x hi");
        check(by.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO) == 8.0, "errorbar y lo");
        check(by.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) == 12.0, "errorbar y hi");

        // 1..9 plus a lone 100: the quartiles are 3 and 7, so the fences sit at
        // -3 and 13 and the 100 is the only outlier. The bounds have to reach
        // it — an outlier drawn outside the view would look like a bug.
        MemorySegment values = arena.allocate(ValueLayout.JAVA_DOUBLE, 10);
        for (int i = 0; i < 9; i++) values.setAtIndex(ValueLayout.JAVA_DOUBLE, i, i + 1);
        values.setAtIndex(ValueLayout.JAVA_DOUBLE, 9, 100.0);

        MemorySegment group = arena.allocate(ph_box_group.LAYOUT);
        group.set(ValueLayout.JAVA_DOUBLE, ph_box_group.OFFSET_POSITION, 1.0);
        group.set(ValueLayout.ADDRESS, ph_box_group.OFFSET_VALUES, values);
        group.set(ValueLayout.JAVA_INT, ph_box_group.OFFSET_COUNT, 10);
        group.set(ValueLayout.JAVA_INT, ph_box_group.OFFSET_COLOR, PH_COLOR_AUTO);

        MemorySegment box = ph_box_desc.allocate(arena);
        ph_box_desc_init(box);
        box.set(ValueLayout.ADDRESS, ph_box_desc.OFFSET_GROUPS, group);
        box.set(ValueLayout.JAVA_INT, ph_box_desc.OFFSET_GROUP_COUNT, 1);
        box.set(ValueLayout.JAVA_DOUBLE, ph_box_desc.OFFSET_WIDTH, 0.8);
        checkEq(ph_plot_add_box(plot, box, handle), PH_OK, "ph_plot_add_box");
        long boxLayer = handle.get(ValueLayout.JAVA_LONG, 0);
        checkEq(ph_layer_bounds(boxLayer, bx, by), PH_OK, "box bounds");
        check(bx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO) == 0.6, "box x lo");
        check(bx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) == 1.4, "box x hi");
        check(by.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO) == 1.0, "box y lo");
        check(by.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) == 100.0, "box y hi");

        checkEq(ph_layer_destroy(errLayer), PH_OK, "the error bar layer is destroyed");
        checkEq(ph_layer_destroy(boxLayer), PH_OK, "the box layer is destroyed");
        ran("ph_errorbar_desc_init", "ph_box_desc_init", "ph_plot_add_errorbar",
            "ph_plot_add_box");
    }

    /** Annotations: every type, and the two ways one leaves again. */
    static void annotations(Arena arena, long plot) {
        MemorySegment a = ph_annotation.allocate(arena);
        ph_annotation_init(a);
        MemorySegment id = arena.allocate(ValueLayout.JAVA_INT);

        // One of each type, so every branch of the renderer is reached.
        final int[] types = {PH_ANNOTATION_SPAN, PH_ANNOTATION_BAND, PH_ANNOTATION_BOX,
                             PH_ANNOTATION_LINE, PH_ANNOTATION_RAY, PH_ANNOTATION_FIB};
        int[] ids = new int[types.length + 1];
        for (int i = 0; i < types.length; i++) {
            ph_annotation_init(a);
            a.set(ValueLayout.JAVA_INT, ph_annotation.OFFSET_TYPE, types[i]);
            a.set(ValueLayout.JAVA_DOUBLE, ph_annotation.OFFSET_X0, 1.0);
            a.set(ValueLayout.JAVA_DOUBLE, ph_annotation.OFFSET_Y0, 1.0);
            a.set(ValueLayout.JAVA_DOUBLE, ph_annotation.OFFSET_X1, 3.0);
            a.set(ValueLayout.JAVA_DOUBLE, ph_annotation.OFFSET_Y1, 4.0);
            a.set(ValueLayout.JAVA_DOUBLE, ph_annotation.OFFSET_HIGH, 5.0);
            a.set(ValueLayout.JAVA_DOUBLE, ph_annotation.OFFSET_LOW, 1.0);
            checkEq(ph_plot_add_annotation(plot, a, id), PH_OK, "ph_plot_add_annotation");
            ids[i] = id.get(ValueLayout.JAVA_INT, 0);
            check(ids[i] != 0, "an annotation id is not zero");
        }

        // A label needs text: one without draws nothing, which is the
        // silent-blank failure this ABI reports rather than performs.
        ph_annotation_init(a);
        a.set(ValueLayout.JAVA_INT, ph_annotation.OFFSET_TYPE, PH_ANNOTATION_LABEL);
        checkEq(ph_plot_add_annotation(plot, a, id), PH_E_INVALID_ARGUMENT,
                "a label annotation needs text");
        a.set(ValueLayout.ADDRESS, ph_annotation.OFFSET_TEXT, utf8(arena, "peak"));
        checkEq(ph_plot_add_annotation(plot, a, id), PH_OK, "with text it is fine");
        ids[types.length] = id.get(ValueLayout.JAVA_INT, 0);

        ph_annotation_init(a);
        a.set(ValueLayout.JAVA_INT, ph_annotation.OFFSET_TYPE, 99);
        checkEq(ph_plot_add_annotation(plot, a, id), PH_E_INVALID_ARGUMENT,
                "an unknown annotation type");

        // Ids are unique, and removing one twice is an error the second time.
        for (int i = 0; i < ids.length; i++) {
            for (int j = i + 1; j < ids.length; j++) check(ids[i] != ids[j], "ids are distinct");
        }
        checkEq(ph_plot_remove_annotation(plot, ids[0]), PH_OK, "ph_plot_remove_annotation");
        checkEq(ph_plot_remove_annotation(plot, ids[0]), PH_E_INVALID_ARGUMENT,
                "removing it twice is not allowed");
        checkEq(ph_plot_clear_annotations(plot), PH_OK, "ph_plot_clear_annotations");
        checkEq(ph_plot_clear_annotations(plot), PH_OK, "clearing an empty list is fine");
        checkEq(ph_plot_remove_annotation(plot, ids[1]), PH_E_INVALID_ARGUMENT,
                "clear removed the rest");

        ran("ph_annotation_init", "ph_plot_add_annotation", "ph_plot_remove_annotation",
            "ph_plot_clear_annotations");
    }

    /** Iso-lines and a node-link graph — the last two layers, and the only two
     * whose geometry the core derives rather than receives. */
    static void isoAndGraph(Arena arena, long plot) {
        // A 3x3 grid rising left to right. A level at 1.5 crosses every row
        // between the middle and right columns, so there are lines to find.
        MemorySegment values = arena.allocate(ValueLayout.JAVA_DOUBLE, 9);
        for (int i = 0; i < 9; i++) values.setAtIndex(ValueLayout.JAVA_DOUBLE, i, i % 3);

        MemorySegment contour = ph_contour_desc.allocate(arena);
        ph_contour_desc_init(contour);
        contour.set(ValueLayout.ADDRESS, ph_contour_desc.OFFSET_VALUES, values);
        contour.set(ValueLayout.JAVA_INT, ph_contour_desc.OFFSET_COLS, 3);
        contour.set(ValueLayout.JAVA_INT, ph_contour_desc.OFFSET_ROWS, 3);
        contour.set(ValueLayout.JAVA_DOUBLE, ph_contour_desc.OFFSET_X + ph_range.OFFSET_LO, 0.0);
        contour.set(ValueLayout.JAVA_DOUBLE, ph_contour_desc.OFFSET_X + ph_range.OFFSET_HI, 8.0);
        contour.set(ValueLayout.JAVA_DOUBLE, ph_contour_desc.OFFSET_Y + ph_range.OFFSET_LO, 1.0);
        contour.set(ValueLayout.JAVA_DOUBLE, ph_contour_desc.OFFSET_Y + ph_range.OFFSET_HI, 5.0);
        MemorySegment handle = arena.allocate(ValueLayout.JAVA_LONG);
        checkEq(ph_plot_add_contour(plot, contour, handle), PH_OK, "ph_plot_add_contour");
        long contourLayer = handle.get(ValueLayout.JAVA_LONG, 0);

        MemorySegment bx = ph_range.allocate(arena);
        MemorySegment by = ph_range.allocate(arena);
        checkEq(ph_layer_bounds(contourLayer, bx, by), PH_OK, "contour bounds");
        // The bounds are the grid's extent, whatever the lines inside it do.
        check(bx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) == 8.0, "contour x hi");
        check(by.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO) == 1.0, "contour y lo");

        // Three nodes in a line, two edges. Explicit positions, so the bounds
        // are arithmetic rather than whatever the layout settles on.
        MemorySegment nx = arena.allocate(ValueLayout.JAVA_DOUBLE, 3);
        MemorySegment ny = arena.allocate(ValueLayout.JAVA_DOUBLE, 3);
        for (int i = 0; i < 3; i++) {
            nx.setAtIndex(ValueLayout.JAVA_DOUBLE, i, i * 2.0);
            ny.setAtIndex(ValueLayout.JAVA_DOUBLE, i, i == 1 ? 5.0 : 0.0);
        }
        MemorySegment edges = arena.allocate(ph_edge.LAYOUT, 2);
        edges.set(ValueLayout.JAVA_INT, ph_edge.OFFSET_A, 0);
        edges.set(ValueLayout.JAVA_INT, ph_edge.OFFSET_B, 1);
        edges.set(ValueLayout.JAVA_INT, ph_edge.SIZE + ph_edge.OFFSET_A, 1);
        edges.set(ValueLayout.JAVA_INT, ph_edge.SIZE + ph_edge.OFFSET_B, 2);

        MemorySegment graph = ph_graph_desc.allocate(arena);
        ph_graph_desc_init(graph);
        graph.set(ValueLayout.ADDRESS, ph_graph_desc.OFFSET_X, nx);
        graph.set(ValueLayout.ADDRESS, ph_graph_desc.OFFSET_Y, ny);
        graph.set(ValueLayout.JAVA_INT, ph_graph_desc.OFFSET_NODE_COUNT, 3);
        graph.set(ValueLayout.ADDRESS, ph_graph_desc.OFFSET_EDGES, edges);
        graph.set(ValueLayout.JAVA_INT, ph_graph_desc.OFFSET_EDGE_COUNT, 2);
        checkEq(ph_plot_add_graph(plot, graph, handle), PH_OK, "ph_plot_add_graph");
        long graphLayer = handle.get(ValueLayout.JAVA_LONG, 0);
        checkEq(ph_layer_bounds(graphLayer, bx, by), PH_OK, "graph bounds");
        check(bx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) == 4.0, "graph x hi");
        check(by.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) == 5.0, "graph y hi");
        checkEq(ph_layer_destroy(graphLayer), PH_OK, "the graph layer is destroyed");

        // No positions at all: the layer lays the graph out itself, and the
        // seed circle puts everything inside a unit box around the origin.
        graph.set(ValueLayout.ADDRESS, ph_graph_desc.OFFSET_X, MemorySegment.NULL);
        graph.set(ValueLayout.ADDRESS, ph_graph_desc.OFFSET_Y, MemorySegment.NULL);
        graph.set(ValueLayout.JAVA_INT, ph_graph_desc.OFFSET_LAYOUT_ITERATIONS, 40);
        checkEq(ph_plot_add_graph(plot, graph, handle), PH_OK, "a graph with no positions");
        long laidLayer = handle.get(ValueLayout.JAVA_LONG, 0);
        checkEq(ph_layer_bounds(laidLayer, bx, by), PH_OK, "laid-out bounds");
        check(Math.abs(bx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO)) < 10.0
              && Math.abs(bx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI)) < 10.0,
              "the layout stays near the origin");
        checkEq(ph_layer_destroy(laidLayer), PH_OK, "the laid-out layer is destroyed");

        // One position array without the other is a mistake, not a request.
        graph.set(ValueLayout.ADDRESS, ph_graph_desc.OFFSET_X, nx);
        checkEq(ph_plot_add_graph(plot, graph, handle), PH_E_INVALID_ARGUMENT,
                "x without y is rejected");

        checkEq(ph_layer_destroy(contourLayer), PH_OK, "the contour layer is destroyed");
        ran("ph_contour_desc_init", "ph_graph_desc_init", "ph_plot_add_contour",
            "ph_plot_add_graph");
    }

    /** Binned hexagons and a vector field — the two layers that colour themselves. */
    static void fields(Arena arena, long plot) {
        // Nine points in a 3x3 block, all inside one hex when the radius is
        // large: one cell, and bounds that are the points' own extent rather
        // than the hexagon's.
        MemorySegment xs = arena.allocate(ValueLayout.JAVA_DOUBLE, 9);
        MemorySegment ys = arena.allocate(ValueLayout.JAVA_DOUBLE, 9);
        for (int i = 0; i < 9; i++) {
            xs.setAtIndex(ValueLayout.JAVA_DOUBLE, i, (i % 3) * 0.1);
            ys.setAtIndex(ValueLayout.JAVA_DOUBLE, i, (i / 3) * 0.1);
        }
        MemorySegment hex = ph_hexbin_desc.allocate(arena);
        ph_hexbin_desc_init(hex);
        hex.set(ValueLayout.ADDRESS, ph_hexbin_desc.OFFSET_X, xs);
        hex.set(ValueLayout.ADDRESS, ph_hexbin_desc.OFFSET_Y, ys);
        hex.set(ValueLayout.JAVA_INT, ph_hexbin_desc.OFFSET_COUNT, 9);
        hex.set(ValueLayout.JAVA_DOUBLE, ph_hexbin_desc.OFFSET_RADIUS, 5.0);
        MemorySegment handle = arena.allocate(ValueLayout.JAVA_LONG);
        checkEq(ph_plot_add_hexbin(plot, hex, handle), PH_OK, "ph_plot_add_hexbin");
        long hexLayer = handle.get(ValueLayout.JAVA_LONG, 0);

        MemorySegment bx = ph_range.allocate(arena);
        MemorySegment by = ph_range.allocate(arena);
        checkEq(ph_layer_bounds(hexLayer, bx, by), PH_OK, "hexbin bounds");
        check(bx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO) == 0.0, "hexbin x lo");
        check(Math.abs(bx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) - 0.2) < 1e-9,
              "the bounds are the points, not the hexagons");

        // Two arrows of length 1 and 3 from the origin. With an explicit scale
        // of 1 the tips land at x = 1 and x = 3, so the bounds are the tips.
        MemorySegment ax = arena.allocate(ValueLayout.JAVA_DOUBLE, 2);
        MemorySegment ay = arena.allocate(ValueLayout.JAVA_DOUBLE, 2);
        MemorySegment au = arena.allocate(ValueLayout.JAVA_DOUBLE, 2);
        MemorySegment av = arena.allocate(ValueLayout.JAVA_DOUBLE, 2);
        au.setAtIndex(ValueLayout.JAVA_DOUBLE, 0, 1.0);
        au.setAtIndex(ValueLayout.JAVA_DOUBLE, 1, 3.0);
        av.setAtIndex(ValueLayout.JAVA_DOUBLE, 0, 0.0);
        av.setAtIndex(ValueLayout.JAVA_DOUBLE, 1, -2.0);

        MemorySegment quiver = ph_quiver_desc.allocate(arena);
        ph_quiver_desc_init(quiver);
        quiver.set(ValueLayout.ADDRESS, ph_quiver_desc.OFFSET_X, ax);
        quiver.set(ValueLayout.ADDRESS, ph_quiver_desc.OFFSET_Y, ay);
        quiver.set(ValueLayout.ADDRESS, ph_quiver_desc.OFFSET_U, au);
        quiver.set(ValueLayout.ADDRESS, ph_quiver_desc.OFFSET_V, av);
        quiver.set(ValueLayout.JAVA_INT, ph_quiver_desc.OFFSET_COUNT, 2);
        quiver.set(ValueLayout.JAVA_DOUBLE, ph_quiver_desc.OFFSET_SCALE, 1.0);
        quiver.set(ValueLayout.JAVA_INT, ph_quiver_desc.OFFSET_COLOR_BY, 1);
        checkEq(ph_plot_add_quiver(plot, quiver, handle), PH_OK, "ph_plot_add_quiver");
        long quiverLayer = handle.get(ValueLayout.JAVA_LONG, 0);
        checkEq(ph_layer_bounds(quiverLayer, bx, by), PH_OK, "quiver bounds");
        check(bx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) == 3.0,
              "the bounds reach the arrow tips");
        check(by.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO) == -2.0, "in both directions");

        // Four arrays and a count, and all four are required.
        quiver.set(ValueLayout.ADDRESS, ph_quiver_desc.OFFSET_V, MemorySegment.NULL);
        checkEq(ph_plot_add_quiver(plot, quiver, handle), PH_E_INVALID_ARGUMENT,
                "u and v are both required");

        checkEq(ph_layer_destroy(hexLayer), PH_OK, "the hexbin layer is destroyed");
        checkEq(ph_layer_destroy(quiverLayer), PH_OK, "the quiver layer is destroyed");
        ran("ph_hexbin_desc_init", "ph_quiver_desc_init", "ph_plot_add_hexbin",
            "ph_plot_add_quiver");
    }

    /** The two OHLC shapes, which share their arrays, their width and their bounds. */
    static void ohlc(Arena arena, long plot) {
        // Four sessions at x = 0, 1, 2, 3. The default width is 70% of the
        // median spacing, so 0.7 — and the bounds reach half of that either
        // side of the first and last bar.
        final double[][] bars = {{0, 10, 12, 9, 11}, {1, 11, 14, 10, 10},
                                 {2, 10, 11, 6, 7},  {3, 7, 15, 7, 13}};
        MemorySegment xs = arena.allocate(ValueLayout.JAVA_DOUBLE, 4);
        MemorySegment open = arena.allocate(ValueLayout.JAVA_DOUBLE, 4);
        MemorySegment high = arena.allocate(ValueLayout.JAVA_DOUBLE, 4);
        MemorySegment low = arena.allocate(ValueLayout.JAVA_DOUBLE, 4);
        MemorySegment close = arena.allocate(ValueLayout.JAVA_DOUBLE, 4);
        for (int i = 0; i < 4; i++) {
            xs.setAtIndex(ValueLayout.JAVA_DOUBLE, i, bars[i][0]);
            open.setAtIndex(ValueLayout.JAVA_DOUBLE, i, bars[i][1]);
            high.setAtIndex(ValueLayout.JAVA_DOUBLE, i, bars[i][2]);
            low.setAtIndex(ValueLayout.JAVA_DOUBLE, i, bars[i][3]);
            close.setAtIndex(ValueLayout.JAVA_DOUBLE, i, bars[i][4]);
        }

        MemorySegment candle = ph_candlestick_desc.allocate(arena);
        ph_candlestick_desc_init(candle);
        candle.set(ValueLayout.ADDRESS, ph_candlestick_desc.OFFSET_X, xs);
        candle.set(ValueLayout.ADDRESS, ph_candlestick_desc.OFFSET_OPEN, open);
        candle.set(ValueLayout.ADDRESS, ph_candlestick_desc.OFFSET_HIGH, high);
        candle.set(ValueLayout.ADDRESS, ph_candlestick_desc.OFFSET_LOW, low);
        candle.set(ValueLayout.ADDRESS, ph_candlestick_desc.OFFSET_CLOSE, close);
        candle.set(ValueLayout.JAVA_INT, ph_candlestick_desc.OFFSET_COUNT, 4);
        MemorySegment handle = arena.allocate(ValueLayout.JAVA_LONG);
        checkEq(ph_plot_add_candlestick(plot, candle, handle), PH_OK, "ph_plot_add_candlestick");
        long candleLayer = handle.get(ValueLayout.JAVA_LONG, 0);

        MemorySegment bx = ph_range.allocate(arena);
        MemorySegment by = ph_range.allocate(arena);
        checkEq(ph_layer_bounds(candleLayer, bx, by), PH_OK, "candlestick bounds");
        check(Math.abs(bx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO) + 0.35) < 1e-9,
              "the body reaches half a width past the first bar");
        check(Math.abs(bx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) - 3.35) < 1e-9,
              "and past the last");
        // y is the low of the lowest bar to the high of the highest, not the
        // opens and closes — the wick is part of the chart.
        check(by.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO) == 6.0, "candlestick y lo");
        check(by.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) == 15.0, "candlestick y hi");

        // An explicit width overrides the median-spacing default.
        candle.set(ValueLayout.JAVA_DOUBLE, ph_candlestick_desc.OFFSET_WIDTH, 2.0);
        checkEq(ph_plot_add_candlestick(plot, candle, handle), PH_OK, "an explicit width");
        long wideLayer = handle.get(ValueLayout.JAVA_LONG, 0);
        checkEq(ph_layer_bounds(wideLayer, bx, by), PH_OK, "wide candlestick bounds");
        check(bx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO) == -1.0, "the width is used");
        checkEq(ph_layer_destroy(wideLayer), PH_OK, "the wide layer is destroyed");

        MemorySegment bar = ph_ohlc_desc.allocate(arena);
        ph_ohlc_desc_init(bar);
        bar.set(ValueLayout.ADDRESS, ph_ohlc_desc.OFFSET_X, xs);
        bar.set(ValueLayout.ADDRESS, ph_ohlc_desc.OFFSET_OPEN, open);
        bar.set(ValueLayout.ADDRESS, ph_ohlc_desc.OFFSET_HIGH, high);
        bar.set(ValueLayout.ADDRESS, ph_ohlc_desc.OFFSET_LOW, low);
        bar.set(ValueLayout.ADDRESS, ph_ohlc_desc.OFFSET_CLOSE, close);
        bar.set(ValueLayout.JAVA_INT, ph_ohlc_desc.OFFSET_COUNT, 4);
        checkEq(ph_plot_add_ohlc(plot, bar, handle), PH_OK, "ph_plot_add_ohlc");
        long ohlcLayer = handle.get(ValueLayout.JAVA_LONG, 0);
        MemorySegment obx = ph_range.allocate(arena);
        MemorySegment oby = ph_range.allocate(arena);
        checkEq(ph_layer_bounds(ohlcLayer, obx, oby), PH_OK, "ohlc bounds");
        // The two shapes are the same data under the same width rule, so they
        // must occupy the same space.
        check(Math.abs(obx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO) + 0.35) < 1e-9,
              "ohlc spans the same x as the candlesticks");
        check(Math.abs(obx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) - 3.35) < 1e-9,
              "at both ends");
        check(oby.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO) == 6.0, "ohlc y lo");
        check(oby.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) == 15.0, "ohlc y hi");

        // Four arrays and a count is not enough: the fifth is required too.
        bar.set(ValueLayout.ADDRESS, ph_ohlc_desc.OFFSET_CLOSE, MemorySegment.NULL);
        checkEq(ph_plot_add_ohlc(plot, bar, handle), PH_E_INVALID_ARGUMENT,
                "all five arrays are required");

        checkEq(ph_layer_destroy(candleLayer), PH_OK, "the candlestick layer is destroyed");
        checkEq(ph_layer_destroy(ohlcLayer), PH_OK, "the ohlc layer is destroyed");
        ran("ph_candlestick_desc_init", "ph_ohlc_desc_init", "ph_plot_add_candlestick",
            "ph_plot_add_ohlc");
    }

    /** The two textured-quad layers: a colormapped grid and raw RGBA pixels. */
    static void grids(Arena arena, long plot) {
        MemorySegment values = arena.allocate(ValueLayout.JAVA_DOUBLE, 6);
        for (int i = 0; i < 6; i++) values.setAtIndex(ValueLayout.JAVA_DOUBLE, i, i);

        MemorySegment heat = ph_heatmap_desc.allocate(arena);
        ph_heatmap_desc_init(heat);
        heat.set(ValueLayout.ADDRESS, ph_heatmap_desc.OFFSET_VALUES, values);
        heat.set(ValueLayout.JAVA_INT, ph_heatmap_desc.OFFSET_COLS, 3);
        heat.set(ValueLayout.JAVA_INT, ph_heatmap_desc.OFFSET_ROWS, 2);
        heat.set(ValueLayout.JAVA_DOUBLE, ph_heatmap_desc.OFFSET_X + ph_range.OFFSET_LO, -1.0);
        heat.set(ValueLayout.JAVA_DOUBLE, ph_heatmap_desc.OFFSET_X + ph_range.OFFSET_HI, 2.0);
        heat.set(ValueLayout.JAVA_DOUBLE, ph_heatmap_desc.OFFSET_Y + ph_range.OFFSET_LO, 0.0);
        heat.set(ValueLayout.JAVA_DOUBLE, ph_heatmap_desc.OFFSET_Y + ph_range.OFFSET_HI, 4.0);
        MemorySegment handle = arena.allocate(ValueLayout.JAVA_LONG);
        checkEq(ph_plot_add_heatmap(plot, heat, handle), PH_OK, "ph_plot_add_heatmap");
        long heatLayer = handle.get(ValueLayout.JAVA_LONG, 0);

        MemorySegment bx = ph_range.allocate(arena);
        MemorySegment by = ph_range.allocate(arena);
        checkEq(ph_layer_bounds(heatLayer, bx, by), PH_OK, "heatmap bounds");
        // The bounds are the extent, not the cell count — a grid says where it
        // is, and its resolution is nobody else's business.
        check(bx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO) == -1.0, "heatmap x lo");
        check(by.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) == 4.0, "heatmap y hi");

        // An empty grid is not an error, but it has no bounds to report.
        MemorySegment bare = ph_heatmap_desc.allocate(arena);
        ph_heatmap_desc_init(bare);
        checkEq(ph_plot_add_heatmap(plot, bare, handle), PH_OK, "an empty heatmap is allowed");
        long emptyLayer = handle.get(ValueLayout.JAVA_LONG, 0);
        checkEq(ph_layer_bounds(emptyLayer, bx, by), PH_E_UNSUPPORTED, "and has no bounds");
        checkEq(ph_layer_destroy(emptyLayer), PH_OK, "the empty heatmap is destroyed");

        // Two by two RGBA pixels. The values are never read back, so what is
        // checked is that the layer accepted them and knows where it sits.
        MemorySegment pixels = arena.allocate(ValueLayout.JAVA_BYTE, 16);
        for (int i = 0; i < 16; i++) pixels.setAtIndex(ValueLayout.JAVA_BYTE, i, (byte) (i * 16));
        MemorySegment image = ph_image_desc.allocate(arena);
        ph_image_desc_init(image);
        image.set(ValueLayout.ADDRESS, ph_image_desc.OFFSET_PIXELS, pixels);
        image.set(ValueLayout.JAVA_INT, ph_image_desc.OFFSET_WIDTH, 2);
        image.set(ValueLayout.JAVA_INT, ph_image_desc.OFFSET_HEIGHT, 2);
        image.set(ValueLayout.JAVA_DOUBLE, ph_image_desc.OFFSET_X + ph_range.OFFSET_LO, 5.0);
        image.set(ValueLayout.JAVA_DOUBLE, ph_image_desc.OFFSET_X + ph_range.OFFSET_HI, 9.0);
        image.set(ValueLayout.JAVA_DOUBLE, ph_image_desc.OFFSET_Y + ph_range.OFFSET_LO, 5.0);
        image.set(ValueLayout.JAVA_DOUBLE, ph_image_desc.OFFSET_Y + ph_range.OFFSET_HI, 6.0);
        checkEq(ph_plot_add_image(plot, image, handle), PH_OK, "ph_plot_add_image");
        long imageLayer = handle.get(ValueLayout.JAVA_LONG, 0);
        checkEq(ph_layer_bounds(imageLayer, bx, by), PH_OK, "image bounds");
        check(bx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) == 9.0, "image x hi");
        check(by.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO) == 5.0, "image y lo");

        // Pixels without dimensions is a caller mistake worth naming.
        image.set(ValueLayout.ADDRESS, ph_image_desc.OFFSET_PIXELS, MemorySegment.NULL);
        checkEq(ph_plot_add_image(plot, image, handle), PH_E_INVALID_ARGUMENT,
                "a sized image needs pixels");

        checkEq(ph_layer_destroy(heatLayer), PH_OK, "the heatmap layer is destroyed");
        checkEq(ph_layer_destroy(imageLayer), PH_OK, "the image layer is destroyed");
        ran("ph_heatmap_desc_init", "ph_image_desc_init", "ph_plot_add_heatmap",
            "ph_plot_add_image");
    }

    /** Filled polygons, including the hole path through the triangulator. */
    static void patches(Arena arena, long plot) {
        // A 10x10 square with a 4x4 hole: eight vertices, the hole starting at
        // vertex four. Area 84, which is what the bounds cannot tell us — but
        // the bounds do tell us the ring crossed intact.
        final double[] ring = {0, 0, 10, 0, 10, 10, 0, 10, 3, 3, 3, 7, 7, 7, 7, 3};
        MemorySegment xs = arena.allocate(ValueLayout.JAVA_DOUBLE, 8);
        MemorySegment ys = arena.allocate(ValueLayout.JAVA_DOUBLE, 8);
        for (int i = 0; i < 8; i++) {
            xs.setAtIndex(ValueLayout.JAVA_DOUBLE, i, ring[i * 2]);
            ys.setAtIndex(ValueLayout.JAVA_DOUBLE, i, ring[i * 2 + 1]);
        }
        MemorySegment holes = arena.allocate(ValueLayout.JAVA_INT, 1);
        holes.setAtIndex(ValueLayout.JAVA_INT, 0, 4);

        MemorySegment patch = arena.allocate(ph_patch.LAYOUT);
        patch.set(ValueLayout.ADDRESS, ph_patch.OFFSET_X, xs);
        patch.set(ValueLayout.ADDRESS, ph_patch.OFFSET_Y, ys);
        patch.set(ValueLayout.JAVA_INT, ph_patch.OFFSET_COUNT, 8);
        patch.set(ValueLayout.ADDRESS, ph_patch.OFFSET_HOLES, holes);
        patch.set(ValueLayout.JAVA_INT, ph_patch.OFFSET_HOLE_COUNT, 1);
        patch.set(ValueLayout.JAVA_INT, ph_patch.OFFSET_COLOR, 0x22c55eff);

        MemorySegment desc = ph_patches_desc.allocate(arena);
        ph_patches_desc_init(desc);
        checkEq(desc.get(ValueLayout.JAVA_FLOAT, ph_patches_desc.OFFSET_OPACITY) == 1.0f ? 1 : 0, 1,
                "ph_patches_desc_init sets opacity");
        desc.set(ValueLayout.ADDRESS, ph_patches_desc.OFFSET_PATCHES, patch);
        desc.set(ValueLayout.JAVA_INT, ph_patches_desc.OFFSET_PATCH_COUNT, 1);

        MemorySegment handle = arena.allocate(ValueLayout.JAVA_LONG);
        checkEq(ph_plot_add_patches(plot, desc, handle), PH_OK, "ph_plot_add_patches");
        long layer = handle.get(ValueLayout.JAVA_LONG, 0);

        MemorySegment bx = ph_range.allocate(arena);
        MemorySegment by = ph_range.allocate(arena);
        checkEq(ph_layer_bounds(layer, bx, by), PH_OK, "patch bounds");
        check(bx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_LO) == 0.0, "patch x lo");
        check(bx.get(ValueLayout.JAVA_DOUBLE, ph_range.OFFSET_HI) == 10.0, "patch x hi");

        // A ring with fewer than three vertices is accepted and draws nothing;
        // a null one is a caller mistake and is refused.
        patch.set(ValueLayout.ADDRESS, ph_patch.OFFSET_X, MemorySegment.NULL);
        checkEq(ph_plot_add_patches(plot, desc, handle), PH_E_INVALID_ARGUMENT,
                "a patch with no coordinates is refused");

        checkEq(ph_layer_destroy(layer), PH_OK, "the patches layer is destroyed");
        ran("ph_patches_desc_init", "ph_plot_add_patches");
    }

    static void interaction(Arena arena, long plot) {
        MemorySegment mode = arena.allocate(ValueLayout.JAVA_INT);
        checkEq(ph_plot_set_mode(plot, PH_MODE_BOX), PH_OK, "ph_plot_set_mode");
        checkEq(ph_plot_get_mode(plot, mode), PH_OK, "ph_plot_get_mode");
        checkEq(mode.get(ValueLayout.JAVA_INT, 0), PH_MODE_BOX, "the mode round-tripped");
        checkEq(ph_plot_set_mode(plot, PH_MODE_PAN), PH_OK, "back to pan");

        checkEq(ph_plot_pointer_down(plot, 100.0, 100.0, PH_BUTTON_LEFT, PH_MOD_NONE), PH_OK,
                "ph_plot_pointer_down");
        checkEq(ph_plot_pointer_move(plot, 140.0, 120.0, PH_MOD_NONE), PH_OK,
                "ph_plot_pointer_move");
        checkEq(ph_plot_pointer_up(plot, 140.0, 120.0, PH_BUTTON_LEFT, PH_MOD_NONE), PH_OK,
                "ph_plot_pointer_up");
        checkEq(ph_plot_pointer_leave(plot), PH_OK, "ph_plot_pointer_leave");
        checkEq(ph_plot_wheel(plot, 200.0, 200.0, 100.0, PH_MOD_NONE), PH_OK, "ph_plot_wheel");
        checkEq(ph_plot_pan_pixels(plot, 12.0, -8.0), PH_OK, "ph_plot_pan_pixels");
        checkEq(ph_plot_zoom_around(plot, 0.5, 0.5, 0.5), PH_OK, "ph_plot_zoom_around");

        // Pixel to data and back, which has to survive two doubles out.
        MemorySegment dx = arena.allocate(ValueLayout.JAVA_DOUBLE);
        MemorySegment dy = arena.allocate(ValueLayout.JAVA_DOUBLE);
        checkEq(ph_plot_data_at_pixel(plot, 300.0, 200.0, dx, dy), PH_OK, "ph_plot_data_at_pixel");
        MemorySegment px = arena.allocate(ValueLayout.JAVA_DOUBLE);
        MemorySegment py = arena.allocate(ValueLayout.JAVA_DOUBLE);
        checkEq(ph_plot_pixel_at_data(plot, dx.get(ValueLayout.JAVA_DOUBLE, 0),
                                      dy.get(ValueLayout.JAVA_DOUBLE, 0), px, py),
                PH_OK, "ph_plot_pixel_at_data");
        check(Math.abs(px.get(ValueLayout.JAVA_DOUBLE, 0) - 300.0) < 1e-6, "px round trip");
        check(Math.abs(py.get(ValueLayout.JAVA_DOUBLE, 0) - 200.0) < 1e-6, "py round trip");

        ran("ph_plot_set_mode", "ph_plot_get_mode", "ph_plot_pointer_down", "ph_plot_pointer_move",
            "ph_plot_pointer_up", "ph_plot_pointer_leave", "ph_plot_wheel", "ph_plot_pan_pixels",
            "ph_plot_zoom_around", "ph_plot_data_at_pixel", "ph_plot_pixel_at_data");
    }

    static void events(Arena arena, long plot) {
        MemorySegment event = ph_event.allocate(arena);
        int drained = 0;
        while (ph_plot_poll_event(plot, event) == PH_OK
               && event.get(ValueLayout.JAVA_INT, ph_event.OFFSET_TYPE) != PH_EVENT_NONE) {
            drained++;
            if (drained > 1000) break;  // the queue is bounded; this is a tripwire
        }
        check(drained > 0, "the interaction above queued events");

        // Hover picking: a move over a point reports which point, once. The plot
        // is 640x480 with the default margins, so its region centre is roughly
        // (348, 228) — but the assertion is only that *something* was picked and
        // then un-picked, because the data under it belongs to earlier steps.
        checkEq(ph_plot_clear_events(plot), PH_OK, "start from an empty queue");
        checkEq(ph_plot_pointer_move(plot, 348.0, 228.0, PH_MOD_NONE), PH_OK, "hover a point");
        int picks = 0;
        while (ph_plot_poll_event(plot, event) == PH_OK
               && event.get(ValueLayout.JAVA_INT, ph_event.OFFSET_TYPE) != PH_EVENT_NONE) {
            if (event.get(ValueLayout.JAVA_INT, ph_event.OFFSET_TYPE) != PH_EVENT_POINT_PICKED) {
                continue;
            }
            picks++;
            check(event.get(ValueLayout.JAVA_INT, ph_event.OFFSET_POINT_VALID) == 1,
                  "the hover found a point");
            check(event.get(ValueLayout.JAVA_INT, ph_event.OFFSET_POINT_INDEX) >= 0,
                  "and named its index");
            check(event.get(ValueLayout.JAVA_LONG, ph_event.OFFSET_LAYER) != PH_NULL_HANDLE,
                  "and the layer it belongs to");
        }
        check(picks == 1, "one pick event, not one per layer");

        checkEq(ph_plot_pointer_leave(plot), PH_OK, "leave clears the pick");
        int clears = 0;
        while (ph_plot_poll_event(plot, event) == PH_OK
               && event.get(ValueLayout.JAVA_INT, ph_event.OFFSET_TYPE) != PH_EVENT_NONE) {
            if (event.get(ValueLayout.JAVA_INT, ph_event.OFFSET_TYPE) != PH_EVENT_POINT_PICKED) {
                continue;
            }
            clears++;
            check(event.get(ValueLayout.JAVA_INT, ph_event.OFFSET_POINT_VALID) == 0,
                  "leaving reports nothing under the cursor");
        }
        check(clears == 1, "and says so once");

        checkEq(ph_plot_poll_event(plot, event), PH_OK, "polling an empty queue still succeeds");
        checkEq(event.get(ValueLayout.JAVA_INT, ph_event.OFFSET_TYPE), PH_EVENT_NONE,
                "an empty queue reports NONE");

        checkEq(ph_plot_wheel(plot, 100.0, 100.0, -100.0, PH_MOD_NONE), PH_OK, "queue something");
        checkEq(ph_plot_clear_events(plot), PH_OK, "ph_plot_clear_events");
        ph_plot_poll_event(plot, event);
        checkEq(event.get(ValueLayout.JAVA_INT, ph_event.OFFSET_TYPE), PH_EVENT_NONE,
                "clear_events emptied it");

        ran("ph_plot_poll_event", "ph_plot_clear_events");
    }

    static void renderingFailsHonestly(Arena arena, long plot) {
        // ph_init got no get_proc_address, so there is nothing to resolve GL
        // against. Both paths have to say that rather than quietly drawing
        // nothing — a blank window with no error is the failure mode that costs
        // a day to diagnose.
        MemorySegment target = ph_frame_target.allocate(arena);
        ph_frame_target_init(target);
        target.set(ValueLayout.JAVA_INT, ph_frame_target.OFFSET_WIDTH, 640);
        target.set(ValueLayout.JAVA_INT, ph_frame_target.OFFSET_HEIGHT, 480);
        checkEq(ph_plot_render(plot, target), PH_E_GL, "ph_plot_render without a context");
        check(Photon.lastError().contains("get_proc_address"),
              "the message names what is missing: " + Photon.lastError());

        MemorySegment pixels = arena.allocate(64L * 64L * 4L);
        checkEq(ph_plot_render_pixels(plot, 64, 64, 1.0f, pixels, 64 * 4), PH_E_GL,
                "ph_plot_render_pixels without a context");
        // Argument validation still runs ahead of the context check.
        checkEq(ph_plot_render_pixels(plot, 64, 64, 1.0f, pixels, 8), PH_E_INVALID_ARGUMENT,
                "a too-small stride is caught first");

        checkEq(ph_plot_needs_redraw(plot), 1, "ph_plot_needs_redraw");

        ran("ph_plot_render", "ph_plot_render_pixels", "ph_plot_needs_redraw");
    }

    /** The reason handles are generation-tagged: Java frees from a finalizer. */
    static void handleSafety(Arena arena, long plot, long line) {
        checkEq(ph_plot_destroy(plot), PH_OK, "ph_plot_destroy");
        checkEq(ph_plot_valid(plot), 0, "the plot handle is dead");
        checkEq(ph_plot_destroy(plot), PH_E_INVALID_HANDLE, "destroying it twice is caught");
        // The layer outlived its plot, and says so instead of dereferencing.
        checkEq(ph_layer_valid(line), 0, "the layer went with its plot");
        checkEq(ph_layer_set_visible(line, 1), PH_E_INVALID_HANDLE, "a stale layer is caught");
        // A handle that never existed.
        checkEq(ph_plot_valid(0xDEADBEEFCAFEL), 0, "an invented handle is not valid");

        ran("ph_plot_destroy");
    }

    public static void main(String[] args) {
        try (Arena arena = Arena.ofConfined()) {
            step("versionAndInit");
            versionAndInit(arena);
            step("descriptorDefaults");
            descriptorDefaults(arena);
            step("colors");
            colors(arena);
            step("colormaps");
            colormaps(arena);
            step("buildPlot");
            long plot = buildPlot(arena);
            step("axes");
            axes(arena, plot);
            step("layers");
            long line = layers(arena, plot);
            step("areaAndBars");
            areaAndBars(arena, plot);
            step("pieAndStem");
            pieAndStem(arena, plot);
            step("errorBarsAndBoxes");
            errorBarsAndBoxes(arena, plot);
            step("annotations");
            annotations(arena, plot);
            step("isoAndGraph");
            isoAndGraph(arena, plot);
            step("fields");
            fields(arena, plot);
            step("ohlc");
            ohlc(arena, plot);
            step("grids");
            grids(arena, plot);
            step("patches");
            patches(arena, plot);
            step("interaction");
            interaction(arena, plot);
            step("events");
            events(arena, plot);
            step("renderingFailsHonestly");
            renderingFailsHonestly(arena, plot);
            step("handleSafety");
            handleSafety(arena, plot, line);

            step("shutdown");
            ph_shutdown();
            ran("ph_shutdown");
        }

        // Every entry point, or the test is not what it claims to be.
        String[] all = Photon.ENTRY_POINTS;
        java.util.List<String> missed = new java.util.ArrayList<>();
        for (String name : all) {
            if (!called.contains(name)) missed.add(name);
        }
        if (!missed.isEmpty()) {
            System.out.println("  FAIL never called: " + String.join(", ", missed));
            failures++;
        }
        System.out.println("  " + called.size() + " of " + all.length + " entry points exercised");

        if (failures == 0) {
            System.out.println("all checks passed");
        } else {
            System.out.println(failures + " check(s) failed");
            System.exit(1);
        }
    }
}
