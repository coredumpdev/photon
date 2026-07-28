// Faz 0 binding sketch — reference, not a shipping binding. See ../README.md.
//
// Demonstrates every marshalling shape the ABI uses from .NET. The points worth
// noting are marked; the rest is mechanical, which is the whole intent.

using System;
using System.Runtime.InteropServices;

namespace Photon.Native
{
    public enum PhResult
    {
        Ok = 0,
        InvalidHandle = -1,
        InvalidArgument = -2,
        OutOfMemory = -3,
        Unsupported = -4,
        NotInitialized = -5,
        AbiMismatch = -6,
        Gl = -7,
        WrongThread = -8,
        Internal = -9,
    }

    public enum PhEventType
    {
        None = 0,
        ViewChanged = 1,
        CursorMoved = 2,
        ModeChanged = 3,
        LayerVisibility = 4,
        RedrawRequested = 5,
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PhRange
    {
        public double Lo;
        public double Hi;
    }

    // Sequential layout with no Pack override: the C header uses no bitfields
    // and no #pragma pack, so the platform default matches on every target.
    [StructLayout(LayoutKind.Sequential)]
    public struct PhEvent
    {
        public uint StructSize;
        public int Type;
        public ulong Layer;
        public PhRange X;
        public PhRange Y;
        public double CursorX;
        public double CursorY;
        public int CursorValid;
        public int Mode;
        public int Visible;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PhFrameTarget
    {
        public uint StructSize;
        public uint Framebuffer;
        public int X, Y, Width, Height;
        public float Dpr;
        public int FlipY;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PhLineDesc
    {
        public uint StructSize;
        public IntPtr X;          // const double*
        public IntPtr Y;
        public int Count;
        public uint Color;
        public float Width;
        public IntPtr Name;       // const char*, UTF-8
        public IntPtr YAxis;
        public int Step;
        public int Join;
        public float MiterLimit;
        public IntPtr Dash;       // const float*
        public int DashCount;
        public int NoDecimate;
        public int RenderType;
    }

    public static class Photon
    {
        // The library name is deliberately identical on all three platforms:
        // libphoton.so / libphoton.dylib / photon.dll, all resolved from "photon".
        private const string Lib = "photon";
        public const uint AbiVersion = 1;

        // CallingConvention.Cdecl is not optional. .NET's default is Winapi,
        // which is StdCall on 32-bit Windows — the header pins cdecl to make
        // the mismatch impossible to hit silently.
        private const CallingConvention Cc = CallingConvention.Cdecl;

        [DllImport(Lib, CallingConvention = Cc)]
        public static extern uint ph_abi_version();

        [DllImport(Lib, CallingConvention = Cc)]
        public static extern PhResult ph_init(uint abiVersion, IntPtr desc);

        [DllImport(Lib, CallingConvention = Cc)]
        public static extern void ph_shutdown();

        // The returned pointer is owned by the library and is thread-local; copy
        // it out immediately rather than holding it.
        [DllImport(Lib, CallingConvention = Cc)]
        private static extern IntPtr ph_last_error();

        public static string LastError() =>
            Marshal.PtrToStringUTF8(ph_last_error()) ?? string.Empty;

        [DllImport(Lib, CallingConvention = Cc)]
        public static extern PhResult ph_plot_create(IntPtr desc, out ulong plot);

        [DllImport(Lib, CallingConvention = Cc)]
        public static extern PhResult ph_plot_destroy(ulong plot);

        [DllImport(Lib, CallingConvention = Cc)]
        public static extern PhResult ph_plot_set_size(ulong plot, int width, int height);

        [DllImport(Lib, CallingConvention = Cc)]
        public static extern PhResult ph_plot_set_domain(ulong plot,
            [MarshalAs(UnmanagedType.LPUTF8Str)] string axis, PhRange domain);

        [DllImport(Lib, CallingConvention = Cc)]
        public static extern PhResult ph_plot_get_domain(ulong plot,
            [MarshalAs(UnmanagedType.LPUTF8Str)] string axis, out PhRange domain);

        [DllImport(Lib, CallingConvention = Cc)]
        public static extern void ph_line_desc_init(ref PhLineDesc desc);

        [DllImport(Lib, CallingConvention = Cc)]
        public static extern PhResult ph_plot_add_line(ulong plot, ref PhLineDesc desc, out ulong layer);

        [DllImport(Lib, CallingConvention = Cc)]
        public static extern PhResult ph_plot_pointer_down(ulong plot, double px, double py, int button, int mods);

        [DllImport(Lib, CallingConvention = Cc)]
        public static extern PhResult ph_plot_pointer_move(ulong plot, double px, double py, int mods);

        [DllImport(Lib, CallingConvention = Cc)]
        public static extern PhResult ph_plot_pointer_up(ulong plot, double px, double py, int button, int mods);

        [DllImport(Lib, CallingConvention = Cc)]
        public static extern PhResult ph_plot_wheel(ulong plot, double px, double py, double deltaY, int mods);

        [DllImport(Lib, CallingConvention = Cc)]
        public static extern void ph_frame_target_init(ref PhFrameTarget target);

        [DllImport(Lib, CallingConvention = Cc)]
        public static extern PhResult ph_plot_render(ulong plot, ref PhFrameTarget target);

        [DllImport(Lib, CallingConvention = Cc)]
        public static extern PhResult ph_plot_poll_event(ulong plot, out PhEvent ev);

        /// <summary>
        /// Adds a line series. The arrays are copied inside the call, so the
        /// fixed block only has to outlive the call itself — no GC pinning, no
        /// pinned handle to leak, which is exactly why the ABI copies.
        /// </summary>
        public static unsafe PhResult AddLine(ulong plot, double[] x, double[] y,
                                              uint color, out ulong layer)
        {
            if (x.Length != y.Length) throw new ArgumentException("x and y must be the same length");
            var desc = new PhLineDesc();
            ph_line_desc_init(ref desc);
            fixed (double* px = x)
            fixed (double* py = y)
            {
                desc.X = (IntPtr)px;
                desc.Y = (IntPtr)py;
                desc.Count = x.Length;
                desc.Color = color;
                return ph_plot_add_line(plot, ref desc, out layer);
            }
        }

        /// <summary>Drains the queue. Call once per frame.</summary>
        public static void DrainEvents(ulong plot, Action<PhEvent> handler)
        {
            while (ph_plot_poll_event(plot, out var ev) == PhResult.Ok &&
                   ev.Type != (int)PhEventType.None)
            {
                handler(ev);
            }
        }
    }
}
