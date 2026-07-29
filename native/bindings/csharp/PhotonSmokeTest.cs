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
        // Non-ASCII, so the UTF-8 marshalling is exercised rather than assumed.
        CheckEq(ph_plot_set_title(plot, "Portföy · σ"), PH_OK, "ph_plot_set_title");
        CheckEq(ph_plot_set_title(plot, null!), PH_OK, "ph_plot_set_title(null)");

        var margin = new ph_margin { top = 20f, right = 20f, bottom = 44f, left = 60f };
        CheckEq(ph_plot_set_margin(plot, in margin), PH_OK, "ph_plot_set_margin");

        Ran("ph_plot_create", "ph_plot_valid", "ph_plot_set_size", "ph_plot_set_theme",
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

        Console.WriteLine("plot, axes, layers, interaction");
        var plot = BuildPlot();
        Axes(plot);
        var line = Layers(plot);
        AreaAndBars(plot);
        PieAndStem(plot);
        ErrorBarsAndBoxes(plot);
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
