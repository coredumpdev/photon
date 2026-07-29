// Every entry point in the ABI, called once, from the marshalled side.
//
// The mirror of bindings/java/PhotonSmokeTest.java, and it exists for the same
// reason: the C tests check the ABI as C sees it, which is the easy direction —
// the compiler has the header. This checks the direction where things actually
// go wrong. A struct field at the wrong offset, a handle truncated to 32 bits,
// a string that never reached UTF-8: none of those are compile errors in C#,
// and most of them do not crash either. They produce a plausible number.
//
// Run it before anything else, on any machine you intend to use the binding on:
//
//     dotnet run --project bindings/csharp
//
// It needs libphoton/photon.dll findable — beside the executable, or on
// PATH / LD_LIBRARY_PATH.
//
// NOTE: this file has never been compiled. There is no .NET SDK on the machine
// it was written on, so unlike the Java twin — which is built and run by ctest —
// nothing here has been verified beyond being generated from the same header.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using static Photon.Native.Ph;

internal static class PhotonSmokeTest
{
    private static int _failures;
    private static readonly SortedSet<string> Called = new();

    private static void Check(bool condition, string what)
    {
        if (condition) return;
        Console.WriteLine($"  FAIL {what}");
        _failures++;
    }

    private static void CheckEq(long actual, long expected, string what) =>
        Check(actual == expected, $"{what} (got {actual}, want {expected})");

    /// Note that an entry point was exercised, so the tally at the end is real.
    private static void Ran(params string[] names)
    {
        foreach (var name in names) Called.Add(name);
    }

    private static string LastError()
    {
        var pointer = ph_last_error();
        return pointer == IntPtr.Zero ? "" : Marshal.PtrToStringUTF8(pointer) ?? "";
    }

    private static void VersionAndInit()
    {
        CheckEq(ph_abi_version(), AbiVersion, "ph_abi_version");
        ph_version(out var major, out _, out _);
        Check(major >= 0, "ph_version major");

        CheckEq(ph_init(AbiVersion + 1, IntPtr.Zero), PH_E_ABI_MISMATCH, "ph_init mismatch");
        Check(LastError().Contains("ABI"), "ph_last_error names the mismatch");

        ph_host_desc_init(out var host);
        CheckEq(host.struct_size, (uint)Marshal.SizeOf<ph_host_desc>(),
                "ph_host_desc_init fills struct_size");
        CheckEq(ph_init(AbiVersion, in host), PH_OK, "ph_init");

        Ran("ph_abi_version", "ph_version", "ph_init", "ph_last_error", "ph_host_desc_init");
    }

    /// The zero-means-defaults rule, from the side that relies on it.
    private static void DescriptorDefaults()
    {
        ph_plot_desc_init(out var plot);
        CheckEq(plot.width, 640, "default width");
        CheckEq(plot.height, 400, "default height");
        // Interaction, hover, crosshair and the colorbar are on by default,
        // which is why the descriptor spells them negatively.
        CheckEq(plot.no_interaction, 0, "no_interaction defaults off");
        // A default-constructed struct must mean the same thing.
        var zeroed = new ph_plot_desc();
        CheckEq(zeroed.no_interaction, 0, "a zeroed descriptor is a valid one");

        ph_line_desc_init(out var line);
        Check(Math.Abs(line.width - 1.5f) < 1e-6f, "default line width");
        CheckEq(line.join, PH_JOIN_ROUND, "default join");

        ph_scatter_desc_init(out var scatter);
        Check(scatter.size > 0.0f, "default marker size");

        ph_axis_desc_init(out var axis);
        CheckEq(axis.type, PH_SCALE_LINEAR, "default scale type");

        ph_axis_config_init(out var config);
        CheckEq(config.struct_size, (uint)Marshal.SizeOf<ph_axis_config>(),
                "ph_axis_config_init fills struct_size");

        ph_frame_target_init(out var target);
        CheckEq(target.struct_size, (uint)Marshal.SizeOf<ph_frame_target>(),
                "ph_frame_target_init fills struct_size");

        Ran("ph_plot_desc_init", "ph_line_desc_init", "ph_scatter_desc_init",
            "ph_axis_desc_init", "ph_axis_config_init", "ph_frame_target_init");
    }

    private static void Colors()
    {
        CheckEq(ph_color_parse("#4f9cff", out var color), PH_OK, "ph_color_parse");
        CheckEq(color, 0x4f9cffffu, "parsed colour");
        CheckEq(ph_color_parse("not a colour", out _), PH_E_UNSUPPORTED,
                "ph_color_parse rejects a name");
        Ran("ph_color_parse");
    }

    /// The colormap and palette registries, and the maths over them.
    private static void Colormaps()
    {
        ph_colormap_spec_init(out var spec);

        // A null name is viridis, whose ends are the dark purple and the yellow
        // every plot of it opens and closes on.
        CheckEq(ph_colormap_sample(in spec, 0.0, out var low), PH_OK, "ph_colormap_sample");
        CheckEq(ph_colormap_sample(in spec, 1.0, out var high), PH_OK, "ph_colormap_sample(1)");
        CheckEq(low, 0x440154ffu, "viridis starts dark purple");
        CheckEq(high, 0xfde725ffu, "viridis ends yellow");

        // Reversing swaps the ends, which is the whole of what it promises.
        spec.reverse = 1;
        CheckEq(ph_colormap_sample(in spec, 0.0, out var reversed), PH_OK, "reversed sample");
        CheckEq(reversed, high, "reverse swaps the ends");
        spec.reverse = 0;

        CheckEq(ph_colormap_register("smoke", new uint[] { 0x000000FF, 0xFFFFFFFF }, 2), PH_OK,
                "ph_colormap_register");
        CheckEq(ph_colormap_register("too-short", new uint[] { 0x000000FF }, 1),
                PH_E_INVALID_ARGUMENT, "one stop is not a colormap");

        int count = ph_colormap_count();
        Check(count >= 13, "twelve built-ins plus the registered one");
        Check(Marshal.PtrToStringUTF8(ph_colormap_name(0)) == "viridis", "viridis is first");
        Check(ph_colormap_name(count) == IntPtr.Zero, "out of range gives null");

        // A symmetric domain has to reach the furthest value on either side, or
        // a diverging map's neutral midpoint drifts off the reference.
        CheckEq(ph_symmetric_domain(new double[] { -2.0, 1.0, 7.0 }, 3, 0.0, out var domain),
                PH_OK, "ph_symmetric_domain");
        Check(domain.lo == -7.0 && domain.hi == 7.0, "the domain reaches the furthest value");

        Check(ph_palette_count() >= 4, "four built-in palettes");
        Check(Marshal.PtrToStringUTF8(ph_palette_name(0)) == "tableau10", "tableau10 is first");
        Check(ph_palette_name(-1) == IntPtr.Zero, "a negative index gives null");
        CheckEq(ph_palette_color("tableau10", 0), 0x4e79a7ffu, "tableau10 starts blue");
        // Cycling, not clamping: the eleventh colour of a ten-colour palette is
        // the first one again.
        CheckEq(ph_palette_color("tableau10", 10), 0x4e79a7ffu, "a palette cycles");
        CheckEq(ph_palette_color(null, 0), 0x4e79a7ffu, "a null name is tableau10");

        CheckEq(ph_palette_register("smoke", new uint[] { 0x123456FF }, 1), PH_OK,
                "ph_palette_register");
        CheckEq(ph_palette_color("smoke", 3), 0x123456ffu,
                "a one-colour palette gives that colour for every index");

        Ran("ph_colormap_spec_init", "ph_colormap_register", "ph_colormap_sample",
            "ph_colormap_count", "ph_colormap_name", "ph_symmetric_domain",
            "ph_palette_register", "ph_palette_count", "ph_palette_name", "ph_palette_color");
    }

    private static ulong BuildPlot()
    {
        ph_plot_desc_init(out var desc);
        desc.width = 800;
        desc.height = 600;
        CheckEq(ph_plot_create(in desc, out var plot), PH_OK, "ph_plot_create");
        Check(plot != PH_NULL_HANDLE, "a live plot handle");
        CheckEq(ph_plot_valid(plot), 1, "ph_plot_valid");

        CheckEq(ph_plot_set_size(plot, 640, 480), PH_OK, "ph_plot_set_size");
        CheckEq(ph_plot_set_theme(plot, PH_THEME_LIGHT), PH_OK, "ph_plot_set_theme");
        // On by default; a plot with no colour-mapping layer reserves nothing
        // for it either way, so this is only the switch being wired.
        CheckEq(ph_plot_set_colorbar(plot, 0), PH_OK, "ph_plot_set_colorbar");
        CheckEq(ph_plot_set_colorbar(plot, 1), PH_OK, "ph_plot_set_colorbar(on)");
        CheckEq(ph_plot_set_tooltip(plot, 0), PH_OK, "ph_plot_set_tooltip");
        CheckEq(ph_plot_set_tooltip(plot, 1), PH_OK, "ph_plot_set_tooltip(on)");
        CheckEq(ph_plot_set_pick_mode(plot, PH_PICK_XY), PH_OK, "ph_plot_set_pick_mode");
        CheckEq(ph_plot_set_pick_mode(plot, 99), PH_E_INVALID_ARGUMENT, "an unknown pick mode");
        CheckEq(ph_plot_set_pick_mode(plot, PH_PICK_X), PH_OK, "back to the default");

        ph_legend_config_init(out var legend);
        legend.enabled = 1;
        legend.position = PH_LEGEND_BOTTOM_LEFT;
        CheckEq(ph_plot_set_legend(plot, in legend), PH_OK, "ph_plot_set_legend");
        legend.position = 42;
        CheckEq(ph_plot_set_legend(plot, in legend), PH_E_INVALID_ARGUMENT,
            "an unknown legend position");
        CheckEq(ph_plot_set_legend(plot, IntPtr.Zero), PH_OK,
            "a null config restores the defaults");
        // Non-ASCII, so the UTF-8 marshalling is exercised rather than assumed.
        CheckEq(ph_plot_set_title(plot, "Portföy · σ"), PH_OK, "ph_plot_set_title");
        CheckEq(ph_plot_set_title(plot, null!), PH_OK, "ph_plot_set_title(null)");

        var margin = new ph_margin { top = 20f, right = 20f, bottom = 44f, left = 60f };
        CheckEq(ph_plot_set_margin(plot, in margin), PH_OK, "ph_plot_set_margin");

        Ran("ph_plot_create", "ph_plot_valid", "ph_plot_set_size", "ph_plot_set_theme",
            "ph_plot_set_colorbar", "ph_plot_set_pick_mode", "ph_plot_set_tooltip",
            "ph_legend_config_init", "ph_plot_set_legend",
            "ph_plot_set_title", "ph_plot_set_margin");
        return plot;
    }

    private static void Axes(ulong plot)
    {
        ph_axis_desc_init(out var axis);
        axis.type = PH_SCALE_LOG;
        CheckEq(ph_plot_set_scale(plot, "y", in axis), PH_OK, "ph_plot_set_scale");
        CheckEq(ph_plot_set_scale(plot, "nope", in axis), PH_E_INVALID_ARGUMENT,
                "ph_plot_set_scale rejects an unknown axis");

        // ph_range crosses by value — two doubles in one struct argument, which
        // is the marshalling most likely to be silently wrong.
        var domain = new ph_range { lo = 1.0, hi = 1000.0 };
        CheckEq(ph_plot_set_domain(plot, "y", domain), PH_OK, "ph_plot_set_domain");
        CheckEq(ph_plot_get_domain(plot, "y", out var readBack), PH_OK, "ph_plot_get_domain");
        Check(readBack.lo == 1.0 && readBack.hi == 1000.0, "the domain survived the round trip");

        var broken = new ph_range { lo = 0.0, hi = double.PositiveInfinity };
        CheckEq(ph_plot_set_domain(plot, "x", broken), PH_E_INVALID_ARGUMENT,
                "an infinite domain is refused");

        ph_axis_desc_init(out axis);
        CheckEq(ph_plot_add_y_axis(plot, "volume", in axis, 1), PH_OK, "ph_plot_add_y_axis");
        CheckEq(ph_plot_add_y_axis(plot, "volume", in axis, 1), PH_E_INVALID_ARGUMENT,
                "a duplicate axis id is refused");
        CheckEq(ph_plot_remove_y_axis(plot, "volume"), PH_OK, "ph_plot_remove_y_axis");

        ph_axis_config_init(out var config);
        var title = Marshal.StringToCoTaskMemUTF8("time (s)");
        try
        {
            config.title = title;
            config.minor_ticks = 4;
            CheckEq(ph_plot_set_axis_config(plot, "x", in config), PH_OK,
                    "ph_plot_set_axis_config");
        }
        finally
        {
            // The library copies the string during the call, so this is safe to
            // free straight after — that is the whole point of rule six.
            Marshal.FreeCoTaskMem(title);
        }
        CheckEq(ph_plot_set_axis_config(plot, "x", IntPtr.Zero), PH_OK,
                "a null config restores the theme defaults");

        var origin = Marshal.StringToCoTaskMemUTF8("origin");
        try
        {
            var ticks = new[]
            {
                new ph_tick { value = -1.0, label = IntPtr.Zero, minor = 0, grid = PH_TOGGLE_DEFAULT },
                new ph_tick { value = 0.0, label = origin, minor = 0, grid = PH_TOGGLE_DEFAULT },
                new ph_tick { value = 1.0, label = IntPtr.Zero, minor = 0, grid = PH_TOGGLE_DEFAULT },
            };
            CheckEq(ph_plot_set_axis_ticks(plot, "x", ticks, ticks.Length), PH_OK,
                    "ph_plot_set_axis_ticks");
        }
        finally
        {
            Marshal.FreeCoTaskMem(origin);
        }
        CheckEq(ph_plot_set_axis_ticks(plot, "x", null!, 0), PH_OK,
                "count 0 restores automatic ticks");

        CheckEq(ph_plot_autoscale(plot), PH_OK, "ph_plot_autoscale");
        CheckEq(ph_plot_reset_view(plot), PH_OK, "ph_plot_reset_view");

        Ran("ph_plot_set_scale", "ph_plot_set_domain", "ph_plot_get_domain",
            "ph_plot_add_y_axis", "ph_plot_remove_y_axis", "ph_plot_set_axis_config",
            "ph_plot_set_axis_ticks", "ph_plot_autoscale", "ph_plot_reset_view");
    }

    private static ulong Layers(ulong plot)
    {
        const int count = 64;
        var xs = new double[count];
        var ys = new double[count];
        for (var i = 0; i < count; i++)
        {
            xs[i] = i;
            ys[i] = Math.Sin(i * 0.2) * 10.0;
        }

        // The arrays are copied during the call, so no pinning and no GC handle:
        // blittable arrays marshal straight through.
        var xsHandle = GCHandle.Alloc(xs, GCHandleType.Pinned);
        var ysHandle = GCHandle.Alloc(ys, GCHandleType.Pinned);
        ulong line;
        try
        {
            ph_line_desc_init(out var desc);
            desc.x = xsHandle.AddrOfPinnedObject();
            desc.y = ysHandle.AddrOfPinnedObject();
            desc.count = count;
            desc.color = 0x38bdf8ffu;
            CheckEq(ph_plot_add_line(plot, in desc, out line), PH_OK, "ph_plot_add_line");
        }
        finally
        {
            xsHandle.Free();
            ysHandle.Free();
        }
        CheckEq(ph_layer_valid(line), 1, "ph_layer_valid");

        // The bounds prove the arrays crossed intact: 64 points, x from 0 to 63.
        CheckEq(ph_layer_bounds(line, out var bx, out var by), PH_OK, "ph_layer_bounds");
        Check(bx.lo == 0.0 && bx.hi == 63.0, "x bounds");
        Check(by.hi <= 10.0, "y bounds");

        var scatterX = GCHandle.Alloc(xs, GCHandleType.Pinned);
        var scatterY = GCHandle.Alloc(ys, GCHandleType.Pinned);
        ulong scatter;
        try
        {
            ph_scatter_desc_init(out var desc);
            desc.x = scatterX.AddrOfPinnedObject();
            desc.y = scatterY.AddrOfPinnedObject();
            desc.count = count;
            desc.marker = PH_MARKER_DIAMOND;
            CheckEq(ph_plot_add_scatter(plot, in desc, out scatter), PH_OK, "ph_plot_add_scatter");

            // Colouring by value used to be rejected outright, because
            // accepting it and drawing one flat colour is the blank-chart
            // failure by another name. The colormaps exist now.
            desc.color_by = scatterY.AddrOfPinnedObject();
            CheckEq(ph_plot_add_scatter(plot, in desc, out var mapped), PH_OK,
                "a scatter coloured by value");
            CheckEq(ph_layer_destroy(mapped), PH_OK, "the mapped layer is destroyed");
        }
        finally
        {
            scatterX.Free();
            scatterY.Free();
        }

        for (var i = 0; i < count; i++) ys[i] = Math.Cos(i * 0.2) * 5.0;
        CheckEq(ph_layer_set_xy(line, xs, ys, count), PH_OK, "ph_layer_set_xy");
        CheckEq(ph_layer_bounds(line, out _, out by), PH_OK, "bounds after streaming");
        Check(by.hi <= 5.0, "the new data replaced the old");

        CheckEq(ph_layer_set_visible(scatter, 0), PH_OK, "ph_layer_set_visible");
        CheckEq(ph_layer_destroy(scatter), PH_OK, "ph_layer_destroy");
        CheckEq(ph_layer_valid(scatter), 0, "a destroyed layer handle is dead");

        Ran("ph_plot_add_line", "ph_plot_add_scatter", "ph_layer_valid", "ph_layer_bounds",
            "ph_layer_set_xy", "ph_layer_set_visible", "ph_layer_destroy");
        return line;
    }

    /// An area band and a bar chart over the same samples.
    private static void AreaAndBars(ulong plot)
    {
        var xs = new double[] { 0, 1, 2, 3, 4, 5, 6, 7 };
        var ys = new double[] { 10, 11, 12, 13, 14, 15, 16, 17 };
        var xsHandle = GCHandle.Alloc(xs, GCHandleType.Pinned);
        var ysHandle = GCHandle.Alloc(ys, GCHandleType.Pinned);
        try
        {
            ph_area_desc_init(out var area);
            area.x = xsHandle.AddrOfPinnedObject();
            area.y = ysHandle.AddrOfPinnedObject();
            area.count = xs.Length;
            area.base_value = 5.0;
            CheckEq(ph_plot_add_area(plot, in area, out var areaLayer), PH_OK, "ph_plot_add_area");
            CheckEq(ph_layer_bounds(areaLayer, out _, out var areaY), PH_OK, "area bounds");
            Check(areaY.lo == 5.0 && areaY.hi == 17.0, "the band runs from base to top");
            CheckEq(ph_layer_destroy(areaLayer), PH_OK, "the area layer is destroyed");

            ph_bar_desc_init(out var bar);
            bar.x = xsHandle.AddrOfPinnedObject();
            bar.y = ysHandle.AddrOfPinnedObject();
            bar.count = xs.Length;
            bar.width = 0.5;
            CheckEq(ph_plot_add_bar(plot, in bar, out var barLayer), PH_OK, "ph_plot_add_bar");
            CheckEq(ph_layer_bounds(barLayer, out var barX, out _), PH_OK, "bar bounds");
            Check(barX.lo == -0.25 && barX.hi == 7.25, "bars are centred on x");
            CheckEq(ph_layer_destroy(barLayer), PH_OK, "the bar layer is destroyed");
        }
        finally
        {
            xsHandle.Free();
            ysHandle.Free();
        }

        Ran("ph_area_desc_init", "ph_bar_desc_init", "ph_plot_add_area", "ph_plot_add_bar");
    }

    /// A donut and a lollipop chart.
    private static void PieAndStem(ulong plot)
    {
        var values = new double[] { 1, 2, 3, 4 };
        var xs = new double[] { 0, 1, 2, 3, 4 };
        var ys = new double[] { 3, 2, 1, 0, -1 };
        var valuesHandle = GCHandle.Alloc(values, GCHandleType.Pinned);
        var xsHandle = GCHandle.Alloc(xs, GCHandleType.Pinned);
        var ysHandle = GCHandle.Alloc(ys, GCHandleType.Pinned);
        try
        {
            ph_pie_desc_init(out var pie);
            pie.values = valuesHandle.AddrOfPinnedObject();
            pie.count = values.Length;
            pie.radius = 2.0;
            pie.inner_radius = 1.0;
            CheckEq(ph_plot_add_pie(plot, in pie, out var pieLayer), PH_OK, "ph_plot_add_pie");
            CheckEq(ph_layer_bounds(pieLayer, out var pieX, out _), PH_OK, "pie bounds");
            Check(pieX.lo == -2.0 && pieX.hi == 2.0, "the bounds are the circle's box");
            CheckEq(ph_layer_destroy(pieLayer), PH_OK, "the pie layer is destroyed");

            ph_stem_desc_init(out var stem);
            stem.x = xsHandle.AddrOfPinnedObject();
            stem.y = ysHandle.AddrOfPinnedObject();
            stem.count = xs.Length;
            CheckEq(ph_plot_add_stem(plot, in stem, out var stemLayer), PH_OK, "ph_plot_add_stem");
            CheckEq(ph_layer_bounds(stemLayer, out _, out var stemY), PH_OK, "stem bounds");
            Check(stemY.lo == -1.0 && stemY.hi == 3.0, "the baseline is inside the range");
            CheckEq(ph_layer_destroy(stemLayer), PH_OK, "the stem layer is destroyed");
        }
        finally
        {
            valuesHandle.Free();
            xsHandle.Free();
            ysHandle.Free();
        }

        Ran("ph_pie_desc_init", "ph_stem_desc_init", "ph_plot_add_pie", "ph_plot_add_stem");
    }

    /// Error bars and box plots — the two layers whose bounds are computed.
    private static void ErrorBarsAndBoxes(ulong plot)
    {
        var xs = new double[] { 0, 1, 2 };
        var ys = new double[] { 10, 10, 10 };
        // 1..9 plus a lone 100: the quartiles are 3 and 7, the fences -3 and 13,
        // so 100 is the only outlier — and the bounds have to reach it.
        var values = new double[] { 1, 2, 3, 4, 5, 6, 7, 8, 9, 100 };
        var xsHandle = GCHandle.Alloc(xs, GCHandleType.Pinned);
        var ysHandle = GCHandle.Alloc(ys, GCHandleType.Pinned);
        var valuesHandle = GCHandle.Alloc(values, GCHandleType.Pinned);
        try
        {
            ph_errorbar_desc_init(out var err);
            err.x = xsHandle.AddrOfPinnedObject();
            err.y = ysHandle.AddrOfPinnedObject();
            err.count = xs.Length;
            err.y_err = 2.0;
            err.x_err = 0.5;
            CheckEq(ph_plot_add_errorbar(plot, in err, out var errLayer), PH_OK,
                "ph_plot_add_errorbar");
            CheckEq(ph_layer_bounds(errLayer, out var errX, out var errY), PH_OK,
                "errorbar bounds");
            Check(errX.lo == -0.5 && errX.hi == 2.5, "the bounds are the whisker ends in x");
            Check(errY.lo == 8.0 && errY.hi == 12.0, "the bounds are the whisker ends in y");
            CheckEq(ph_layer_destroy(errLayer), PH_OK, "the error bar layer is destroyed");

            var group = new ph_box_group
            {
                position = 1.0,
                values = valuesHandle.AddrOfPinnedObject(),
                count = values.Length,
                // Left at PH_COLOR_AUTO, which is zero — the layer then takes
                // the core's default series colour.
            };
            var groupHandle = GCHandle.Alloc(group, GCHandleType.Pinned);
            try
            {
                ph_box_desc_init(out var box);
                box.groups = groupHandle.AddrOfPinnedObject();
                box.group_count = 1;
                box.width = 0.8;
                CheckEq(ph_plot_add_box(plot, in box, out var boxLayer), PH_OK, "ph_plot_add_box");
                CheckEq(ph_layer_bounds(boxLayer, out var boxX, out var boxY), PH_OK,
                    "box bounds");
                Check(boxX.lo == 0.6 && boxX.hi == 1.4, "the box is centred on its position");
                Check(boxY.lo == 1.0 && boxY.hi == 100.0, "the bounds reach the outlier");
                CheckEq(ph_layer_destroy(boxLayer), PH_OK, "the box layer is destroyed");
            }
            finally
            {
                groupHandle.Free();
            }
        }
        finally
        {
            xsHandle.Free();
            ysHandle.Free();
            valuesHandle.Free();
        }

        Ran("ph_errorbar_desc_init", "ph_box_desc_init", "ph_plot_add_errorbar",
            "ph_plot_add_box");
    }

    /// Annotations: every type, and the two ways one leaves again.
    private static void Annotations(ulong plot)
    {
        var types = new[]
        {
            PH_ANNOTATION_SPAN, PH_ANNOTATION_BAND, PH_ANNOTATION_BOX,
            PH_ANNOTATION_LINE, PH_ANNOTATION_RAY, PH_ANNOTATION_FIB,
        };
        var ids = new List<int>();
        foreach (var type in types)
        {
            ph_annotation_init(out var a);
            a.type = type;
            a.x0 = 1.0;
            a.y0 = 1.0;
            a.x1 = 3.0;
            a.y1 = 4.0;
            a.high = 5.0;
            a.low = 1.0;
            CheckEq(ph_plot_add_annotation(plot, in a, out var id), PH_OK,
                "ph_plot_add_annotation");
            Check(id != 0, "an annotation id is not zero");
            ids.Add(id);
        }

        // A label needs text: one without draws nothing, which is the
        // silent-blank failure this ABI reports rather than performs.
        ph_annotation_init(out var label);
        label.type = PH_ANNOTATION_LABEL;
        CheckEq(ph_plot_add_annotation(plot, in label, out _), PH_E_INVALID_ARGUMENT,
            "a label annotation needs text");

        ph_annotation_init(out var bad);
        bad.type = 99;
        CheckEq(ph_plot_add_annotation(plot, in bad, out _), PH_E_INVALID_ARGUMENT,
            "an unknown annotation type");

        Check(ids.Distinct().Count() == ids.Count, "ids are distinct");
        CheckEq(ph_plot_remove_annotation(plot, ids[0]), PH_OK, "ph_plot_remove_annotation");
        CheckEq(ph_plot_remove_annotation(plot, ids[0]), PH_E_INVALID_ARGUMENT,
            "removing it twice is not allowed");
        CheckEq(ph_plot_clear_annotations(plot), PH_OK, "ph_plot_clear_annotations");
        CheckEq(ph_plot_remove_annotation(plot, ids[1]), PH_E_INVALID_ARGUMENT,
            "clear removed the rest");

        Ran("ph_annotation_init", "ph_plot_add_annotation", "ph_plot_remove_annotation",
            "ph_plot_clear_annotations");
    }

    /// Iso-lines and a node-link graph — the only two layers whose geometry the
    /// core derives rather than receives.
    private static void IsoAndGraph(ulong plot)
    {
        // A 3x3 grid rising left to right, and three nodes in a line.
        var values = new double[] { 0, 1, 2, 0, 1, 2, 0, 1, 2 };
        var nx = new double[] { 0, 2, 4 };
        var ny = new double[] { 0, 5, 0 };
        var edges = new[] { new ph_edge { a = 0, b = 1 }, new ph_edge { a = 1, b = 2 } };
        var pins = new[]
        {
            GCHandle.Alloc(values, GCHandleType.Pinned), GCHandle.Alloc(nx, GCHandleType.Pinned),
            GCHandle.Alloc(ny, GCHandleType.Pinned), GCHandle.Alloc(edges, GCHandleType.Pinned),
        };
        try
        {
            ph_contour_desc_init(out var contour);
            contour.values = pins[0].AddrOfPinnedObject();
            contour.cols = 3;
            contour.rows = 3;
            contour.x = new ph_range { lo = 0.0, hi = 8.0 };
            contour.y = new ph_range { lo = 1.0, hi = 5.0 };
            CheckEq(ph_plot_add_contour(plot, in contour, out var contourLayer), PH_OK,
                "ph_plot_add_contour");
            CheckEq(ph_layer_bounds(contourLayer, out var isoX, out var isoY), PH_OK,
                "contour bounds");
            // The bounds are the grid's extent, whatever the lines inside it do.
            Check(isoX.hi == 8.0 && isoY.lo == 1.0, "the contour bounds are its extent");
            CheckEq(ph_layer_destroy(contourLayer), PH_OK, "the contour layer is destroyed");

            ph_graph_desc_init(out var graph);
            graph.x = pins[1].AddrOfPinnedObject();
            graph.y = pins[2].AddrOfPinnedObject();
            graph.node_count = nx.Length;
            graph.edges = pins[3].AddrOfPinnedObject();
            graph.edge_count = edges.Length;
            CheckEq(ph_plot_add_graph(plot, in graph, out var graphLayer), PH_OK,
                "ph_plot_add_graph");
            CheckEq(ph_layer_bounds(graphLayer, out var graphX, out var graphY), PH_OK,
                "graph bounds");
            Check(graphX.hi == 4.0 && graphY.hi == 5.0, "the graph bounds are its nodes");
            CheckEq(ph_layer_destroy(graphLayer), PH_OK, "the graph layer is destroyed");

            // No positions at all: the layer lays the graph out itself.
            graph.x = IntPtr.Zero;
            graph.y = IntPtr.Zero;
            graph.layout_iterations = 40;
            CheckEq(ph_plot_add_graph(plot, in graph, out var laidLayer), PH_OK,
                "a graph with no positions");
            CheckEq(ph_layer_bounds(laidLayer, out var laidX, out _), PH_OK,
                "laid-out bounds");
            Check(Math.Abs(laidX.lo) < 10.0 && Math.Abs(laidX.hi) < 10.0,
                "the layout stays near the origin");
            CheckEq(ph_layer_destroy(laidLayer), PH_OK, "the laid-out layer is destroyed");

            // One position array without the other is a mistake, not a request.
            graph.x = pins[1].AddrOfPinnedObject();
            CheckEq(ph_plot_add_graph(plot, in graph, out _), PH_E_INVALID_ARGUMENT,
                "x without y is rejected");
        }
        finally
        {
            foreach (var pin in pins) pin.Free();
        }

        Ran("ph_contour_desc_init", "ph_graph_desc_init", "ph_plot_add_contour",
            "ph_plot_add_graph");
    }

    /// Binned hexagons and a vector field — the two layers that colour themselves.
    private static void Fields(ulong plot)
    {
        // Nine points in a 3x3 block, all inside one hex at this radius.
        var xs = new double[9];
        var ys = new double[9];
        for (int i = 0; i < 9; i++)
        {
            xs[i] = (i % 3) * 0.1;
            ys[i] = (i / 3) * 0.1;
        }
        // Two arrows of length 1 and 3 from the origin, scale 1, so the tips
        // land at x = 1 and x = 3.
        var au = new double[] { 1.0, 3.0 };
        var av = new double[] { 0.0, -2.0 };
        var ax = new double[] { 0.0, 0.0 };
        var ay = new double[] { 0.0, 0.0 };
        var pins = new[]
        {
            GCHandle.Alloc(xs, GCHandleType.Pinned), GCHandle.Alloc(ys, GCHandleType.Pinned),
            GCHandle.Alloc(ax, GCHandleType.Pinned), GCHandle.Alloc(ay, GCHandleType.Pinned),
            GCHandle.Alloc(au, GCHandleType.Pinned), GCHandle.Alloc(av, GCHandleType.Pinned),
        };
        try
        {
            ph_hexbin_desc_init(out var hex);
            hex.x = pins[0].AddrOfPinnedObject();
            hex.y = pins[1].AddrOfPinnedObject();
            hex.count = xs.Length;
            hex.radius = 5.0;
            CheckEq(ph_plot_add_hexbin(plot, in hex, out var hexLayer), PH_OK,
                "ph_plot_add_hexbin");
            CheckEq(ph_layer_bounds(hexLayer, out var hexX, out _), PH_OK, "hexbin bounds");
            Check(hexX.lo == 0.0 && Math.Abs(hexX.hi - 0.2) < 1e-9,
                "the bounds are the points, not the hexagons");
            CheckEq(ph_layer_destroy(hexLayer), PH_OK, "the hexbin layer is destroyed");

            ph_quiver_desc_init(out var quiver);
            quiver.x = pins[2].AddrOfPinnedObject();
            quiver.y = pins[3].AddrOfPinnedObject();
            quiver.u = pins[4].AddrOfPinnedObject();
            quiver.v = pins[5].AddrOfPinnedObject();
            quiver.count = au.Length;
            quiver.scale = 1.0;
            quiver.color_by = 1;
            CheckEq(ph_plot_add_quiver(plot, in quiver, out var quiverLayer), PH_OK,
                "ph_plot_add_quiver");
            CheckEq(ph_layer_bounds(quiverLayer, out var quiverX, out var quiverY), PH_OK,
                "quiver bounds");
            Check(quiverX.hi == 3.0 && quiverY.lo == -2.0,
                "the bounds reach the arrow tips");
            CheckEq(ph_layer_destroy(quiverLayer), PH_OK, "the quiver layer is destroyed");

            // Four arrays and a count, and all four are required.
            quiver.v = IntPtr.Zero;
            CheckEq(ph_plot_add_quiver(plot, in quiver, out _), PH_E_INVALID_ARGUMENT,
                "u and v are both required");
        }
        finally
        {
            foreach (var pin in pins) pin.Free();
        }

        Ran("ph_hexbin_desc_init", "ph_quiver_desc_init", "ph_plot_add_hexbin",
            "ph_plot_add_quiver");
    }

    /// The two OHLC shapes, which share their arrays, their width and their bounds.
    private static void Ohlc(ulong plot)
    {
        // Four sessions at x = 0..3. The default width is 70% of the median
        // spacing, so 0.7 — and the bounds reach half of that either side.
        var xs = new double[] { 0, 1, 2, 3 };
        var open = new double[] { 10, 11, 10, 7 };
        var high = new double[] { 12, 14, 11, 15 };
        var low = new double[] { 9, 10, 6, 7 };
        var close = new double[] { 11, 10, 7, 13 };
        var handles = new[]
        {
            GCHandle.Alloc(xs, GCHandleType.Pinned), GCHandle.Alloc(open, GCHandleType.Pinned),
            GCHandle.Alloc(high, GCHandleType.Pinned), GCHandle.Alloc(low, GCHandleType.Pinned),
            GCHandle.Alloc(close, GCHandleType.Pinned),
        };
        try
        {
            ph_candlestick_desc_init(out var candle);
            candle.x = handles[0].AddrOfPinnedObject();
            candle.open = handles[1].AddrOfPinnedObject();
            candle.high = handles[2].AddrOfPinnedObject();
            candle.low = handles[3].AddrOfPinnedObject();
            candle.close = handles[4].AddrOfPinnedObject();
            candle.count = xs.Length;
            CheckEq(ph_plot_add_candlestick(plot, in candle, out var candleLayer), PH_OK,
                "ph_plot_add_candlestick");
            CheckEq(ph_layer_bounds(candleLayer, out var candleX, out var candleY), PH_OK,
                "candlestick bounds");
            Check(Math.Abs(candleX.lo + 0.35) < 1e-9 && Math.Abs(candleX.hi - 3.35) < 1e-9,
                "the body reaches half a width past the outer bars");
            // y is the low of the lowest bar to the high of the highest, not
            // the opens and closes — the wick is part of the chart.
            Check(candleY.lo == 6.0 && candleY.hi == 15.0, "the wicks set the y bounds");
            CheckEq(ph_layer_destroy(candleLayer), PH_OK, "the candlestick layer is destroyed");

            // An explicit width overrides the median-spacing default.
            candle.width = 2.0;
            CheckEq(ph_plot_add_candlestick(plot, in candle, out var wideLayer), PH_OK,
                "an explicit width");
            CheckEq(ph_layer_bounds(wideLayer, out var wideX, out _), PH_OK, "wide bounds");
            Check(wideX.lo == -1.0, "the width is used");
            CheckEq(ph_layer_destroy(wideLayer), PH_OK, "the wide layer is destroyed");

            ph_ohlc_desc_init(out var bar);
            bar.x = handles[0].AddrOfPinnedObject();
            bar.open = handles[1].AddrOfPinnedObject();
            bar.high = handles[2].AddrOfPinnedObject();
            bar.low = handles[3].AddrOfPinnedObject();
            bar.close = handles[4].AddrOfPinnedObject();
            bar.count = xs.Length;
            CheckEq(ph_plot_add_ohlc(plot, in bar, out var ohlcLayer), PH_OK, "ph_plot_add_ohlc");
            CheckEq(ph_layer_bounds(ohlcLayer, out var ohlcX, out var ohlcY), PH_OK,
                "ohlc bounds");
            // The two shapes are the same data under the same width rule, so
            // they must occupy the same space.
            Check(Math.Abs(ohlcX.lo + 0.35) < 1e-9 && Math.Abs(ohlcX.hi - 3.35) < 1e-9,
                "ohlc spans the same x as the candlesticks");
            Check(ohlcY.lo == 6.0 && ohlcY.hi == 15.0, "and the same y");
            CheckEq(ph_layer_destroy(ohlcLayer), PH_OK, "the ohlc layer is destroyed");

            // Four arrays and a count is not enough: the fifth is required too.
            bar.close = IntPtr.Zero;
            CheckEq(ph_plot_add_ohlc(plot, in bar, out _), PH_E_INVALID_ARGUMENT,
                "all five arrays are required");
        }
        finally
        {
            foreach (var handle in handles) handle.Free();
        }

        Ran("ph_candlestick_desc_init", "ph_ohlc_desc_init", "ph_plot_add_candlestick",
            "ph_plot_add_ohlc");
    }

    /// The two textured-quad layers: a colormapped grid and raw RGBA pixels.
    private static void Grids(ulong plot)
    {
        var values = new double[] { 0, 1, 2, 3, 4, 5 };
        var valuesHandle = GCHandle.Alloc(values, GCHandleType.Pinned);
        var pixels = new byte[16];
        for (int i = 0; i < pixels.Length; i++) pixels[i] = (byte)(i * 16);
        var pixelsHandle = GCHandle.Alloc(pixels, GCHandleType.Pinned);
        try
        {
            ph_heatmap_desc_init(out var heat);
            heat.values = valuesHandle.AddrOfPinnedObject();
            heat.cols = 3;
            heat.rows = 2;
            heat.x = new ph_range { lo = -1.0, hi = 2.0 };
            heat.y = new ph_range { lo = 0.0, hi = 4.0 };
            CheckEq(ph_plot_add_heatmap(plot, in heat, out var heatLayer), PH_OK,
                "ph_plot_add_heatmap");
            CheckEq(ph_layer_bounds(heatLayer, out var heatX, out var heatY), PH_OK,
                "heatmap bounds");
            // The bounds are the extent, not the cell count — a grid says where
            // it is, and its resolution is nobody else's business.
            Check(heatX.lo == -1.0 && heatX.hi == 2.0, "the heatmap bounds are its extent");
            Check(heatY.hi == 4.0, "in both axes");
            CheckEq(ph_layer_destroy(heatLayer), PH_OK, "the heatmap layer is destroyed");

            // An empty grid is not an error, but it has no bounds to report.
            ph_heatmap_desc_init(out var bare);
            CheckEq(ph_plot_add_heatmap(plot, in bare, out var emptyLayer), PH_OK,
                "an empty heatmap is allowed");
            CheckEq(ph_layer_bounds(emptyLayer, out _, out _), PH_E_UNSUPPORTED,
                "and has no bounds");
            CheckEq(ph_layer_destroy(emptyLayer), PH_OK, "the empty heatmap is destroyed");

            ph_image_desc_init(out var image);
            image.pixels = pixelsHandle.AddrOfPinnedObject();
            image.width = 2;
            image.height = 2;
            image.x = new ph_range { lo = 5.0, hi = 9.0 };
            image.y = new ph_range { lo = 5.0, hi = 6.0 };
            CheckEq(ph_plot_add_image(plot, in image, out var imageLayer), PH_OK,
                "ph_plot_add_image");
            CheckEq(ph_layer_bounds(imageLayer, out var imageX, out var imageY), PH_OK,
                "image bounds");
            Check(imageX.hi == 9.0 && imageY.lo == 5.0, "the image bounds are its extent");
            CheckEq(ph_layer_destroy(imageLayer), PH_OK, "the image layer is destroyed");

            // Pixels without dimensions is a caller mistake worth naming.
            image.pixels = IntPtr.Zero;
            CheckEq(ph_plot_add_image(plot, in image, out _), PH_E_INVALID_ARGUMENT,
                "a sized image needs pixels");
        }
        finally
        {
            valuesHandle.Free();
            pixelsHandle.Free();
        }

        Ran("ph_heatmap_desc_init", "ph_image_desc_init", "ph_plot_add_heatmap",
            "ph_plot_add_image");
    }

    /// Filled polygons, including the hole path through the triangulator.
    private static void Patches(ulong plot)
    {
        // A 10x10 square with a 4x4 hole: eight vertices, the hole starting at
        // vertex four.
        var xs = new double[] { 0, 10, 10, 0, 3, 3, 7, 7 };
        var ys = new double[] { 0, 0, 10, 10, 3, 7, 7, 3 };
        var holes = new[] { 4 };

        var xsHandle = GCHandle.Alloc(xs, GCHandleType.Pinned);
        var ysHandle = GCHandle.Alloc(ys, GCHandleType.Pinned);
        var holesHandle = GCHandle.Alloc(holes, GCHandleType.Pinned);
        ulong layer;
        try
        {
            var patch = new ph_patch
            {
                x = xsHandle.AddrOfPinnedObject(),
                y = ysHandle.AddrOfPinnedObject(),
                count = 8,
                holes = holesHandle.AddrOfPinnedObject(),
                hole_count = 1,
                color = 0x22c55effu,
            };
            var patches = new[] { patch };
            var patchesHandle = GCHandle.Alloc(patches, GCHandleType.Pinned);
            try
            {
                ph_patches_desc_init(out var desc);
                Check(Math.Abs(desc.opacity - 1.0f) < 1e-6f, "ph_patches_desc_init sets opacity");
                desc.patches = patchesHandle.AddrOfPinnedObject();
                desc.patch_count = 1;
                CheckEq(ph_plot_add_patches(plot, in desc, out layer), PH_OK,
                        "ph_plot_add_patches");
            }
            finally
            {
                patchesHandle.Free();
            }
        }
        finally
        {
            xsHandle.Free();
            ysHandle.Free();
            holesHandle.Free();
        }

        CheckEq(ph_layer_bounds(layer, out var bx, out _), PH_OK, "patch bounds");
        Check(bx.lo == 0.0 && bx.hi == 10.0, "the ring crossed intact");
        CheckEq(ph_layer_destroy(layer), PH_OK, "the patches layer is destroyed");

        Ran("ph_patches_desc_init", "ph_plot_add_patches");
    }

    private static void Interaction(ulong plot)
    {
        CheckEq(ph_plot_set_mode(plot, PH_MODE_BOX), PH_OK, "ph_plot_set_mode");
        CheckEq(ph_plot_get_mode(plot, out var mode), PH_OK, "ph_plot_get_mode");
        CheckEq(mode, PH_MODE_BOX, "the mode round-tripped");
        CheckEq(ph_plot_set_mode(plot, PH_MODE_PAN), PH_OK, "back to pan");

        CheckEq(ph_plot_pointer_down(plot, 100.0, 100.0, PH_BUTTON_LEFT, PH_MOD_NONE), PH_OK,
                "ph_plot_pointer_down");
        CheckEq(ph_plot_pointer_move(plot, 140.0, 120.0, PH_MOD_NONE), PH_OK,
                "ph_plot_pointer_move");
        CheckEq(ph_plot_pointer_up(plot, 140.0, 120.0, PH_BUTTON_LEFT, PH_MOD_NONE), PH_OK,
                "ph_plot_pointer_up");
        CheckEq(ph_plot_pointer_leave(plot), PH_OK, "ph_plot_pointer_leave");
        CheckEq(ph_plot_wheel(plot, 200.0, 200.0, 100.0, PH_MOD_NONE), PH_OK, "ph_plot_wheel");
        CheckEq(ph_plot_pan_pixels(plot, 12.0, -8.0), PH_OK, "ph_plot_pan_pixels");
        CheckEq(ph_plot_zoom_around(plot, 0.5, 0.5, 0.5), PH_OK, "ph_plot_zoom_around");

        CheckEq(ph_plot_data_at_pixel(plot, 300.0, 200.0, out var dx, out var dy), PH_OK,
                "ph_plot_data_at_pixel");
        CheckEq(ph_plot_pixel_at_data(plot, dx, dy, out var px, out var py), PH_OK,
                "ph_plot_pixel_at_data");
        Check(Math.Abs(px - 300.0) < 1e-6 && Math.Abs(py - 200.0) < 1e-6,
              "pixel to data and back");

        Ran("ph_plot_set_mode", "ph_plot_get_mode", "ph_plot_pointer_down",
            "ph_plot_pointer_move", "ph_plot_pointer_up", "ph_plot_pointer_leave",
            "ph_plot_wheel", "ph_plot_pan_pixels", "ph_plot_zoom_around",
            "ph_plot_data_at_pixel", "ph_plot_pixel_at_data");
    }

    private static void Events(ulong plot)
    {
        var drained = 0;
        while (ph_plot_poll_event(plot, out var ev) == PH_OK && ev.type != PH_EVENT_NONE)
        {
            if (++drained > 1000) break;  // the queue is bounded; this is a tripwire
        }
        Check(drained > 0, "the interaction above queued events");

        // Hover picking: a move over a point reports which point, once. The plot
        // is 640x480 with the default margins, so its region centre is roughly
        // (348, 228).
        CheckEq(ph_plot_clear_events(plot), PH_OK, "start from an empty queue");
        CheckEq(ph_plot_pointer_move(plot, 348.0, 228.0, PH_MOD_NONE), PH_OK, "hover a point");
        var picks = 0;
        while (ph_plot_poll_event(plot, out var hovered) == PH_OK && hovered.type != PH_EVENT_NONE)
        {
            if (hovered.type != PH_EVENT_POINT_PICKED) continue;
            picks++;
            Check(hovered.point_valid == 1, "the hover found a point");
            Check(hovered.point_index >= 0, "and named its index");
            Check(hovered.layer != PH_NULL_HANDLE, "and the layer it belongs to");
        }
        Check(picks == 1, "one pick event, not one per layer");

        CheckEq(ph_plot_pointer_leave(plot), PH_OK, "leave clears the pick");
        var clears = 0;
        while (ph_plot_poll_event(plot, out var left) == PH_OK && left.type != PH_EVENT_NONE)
        {
            if (left.type != PH_EVENT_POINT_PICKED) continue;
            clears++;
            Check(left.point_valid == 0, "leaving reports nothing under the cursor");
        }
        Check(clears == 1, "and says so once");

        CheckEq(ph_plot_wheel(plot, 100.0, 100.0, -100.0, PH_MOD_NONE), PH_OK, "queue something");
        CheckEq(ph_plot_clear_events(plot), PH_OK, "ph_plot_clear_events");
        ph_plot_poll_event(plot, out var empty);
        CheckEq(empty.type, PH_EVENT_NONE, "clear_events emptied it");

        Ran("ph_plot_poll_event", "ph_plot_clear_events");
    }

    private static void RenderingFailsHonestly(ulong plot)
    {
        // ph_init got no get_proc_address, so there is nothing to resolve GL
        // against. Both paths have to say so rather than quietly drawing
        // nothing: a blank window with no error is the failure mode that costs
        // a day to diagnose.
        ph_frame_target_init(out var target);
        target.width = 640;
        target.height = 480;
        CheckEq(ph_plot_render(plot, in target), PH_E_GL, "ph_plot_render without a context");
        Check(LastError().Contains("get_proc_address"),
              $"the message names what is missing: {LastError()}");

        var pixels = new byte[64 * 64 * 4];
        CheckEq(ph_plot_render_pixels(plot, 64, 64, 1.0f, pixels, 64 * 4), PH_E_GL,
                "ph_plot_render_pixels without a context");
        CheckEq(ph_plot_render_pixels(plot, 64, 64, 1.0f, pixels, 8), PH_E_INVALID_ARGUMENT,
                "a too-small stride is caught first");

        CheckEq(ph_plot_needs_redraw(plot), 1, "ph_plot_needs_redraw");

        Ran("ph_plot_render", "ph_plot_render_pixels", "ph_plot_needs_redraw");
    }

    /// The reason handles are generation-tagged: .NET frees from a finalizer.
    private static void HandleSafety(ulong plot, ulong line)
    {
        CheckEq(ph_plot_destroy(plot), PH_OK, "ph_plot_destroy");
        CheckEq(ph_plot_valid(plot), 0, "the plot handle is dead");
        CheckEq(ph_plot_destroy(plot), PH_E_INVALID_HANDLE, "destroying it twice is caught");
        CheckEq(ph_layer_valid(line), 0, "the layer went with its plot");
        CheckEq(ph_layer_set_visible(line, 1), PH_E_INVALID_HANDLE, "a stale layer is caught");
        CheckEq(ph_plot_valid(0xDEADBEEFCAFEUL), 0, "an invented handle is not valid");

        Ran("ph_plot_destroy");
    }

    private static int Main()
    {
        Console.WriteLine("VersionAndInit");
        VersionAndInit();
        Console.WriteLine("DescriptorDefaults");
        DescriptorDefaults();
        Console.WriteLine("Colors");
        Colors();
        Colormaps();

        Console.WriteLine("plot, axes, layers, interaction");
        var plot = BuildPlot();
        Axes(plot);
        var line = Layers(plot);
        AreaAndBars(plot);
        PieAndStem(plot);
        ErrorBarsAndBoxes(plot);
        Annotations(plot);
        IsoAndGraph(plot);
        Fields(plot);
        Ohlc(plot);
        Grids(plot);
        Patches(plot);
        Interaction(plot);
        Events(plot);
        RenderingFailsHonestly(plot);
        HandleSafety(plot, line);

        ph_shutdown();
        Ran("ph_shutdown");

        // Every entry point, or this is not the test it claims to be. The list
        // comes from the same generator run as the bindings.
        var missed = EntryPoints.Where(name => !Called.Contains(name)).ToArray();
        if (missed.Length > 0)
        {
            Console.WriteLine($"  FAIL never called: {string.Join(", ", missed)}");
            _failures++;
        }
        Console.WriteLine($"  {Called.Count} of {EntryPoints.Length} entry points exercised");

        if (_failures == 0)
        {
            Console.WriteLine("all checks passed");
            return 0;
        }
        Console.WriteLine($"{_failures} check(s) failed");
        return 1;
    }
}
