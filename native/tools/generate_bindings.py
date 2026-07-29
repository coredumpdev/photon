#!/usr/bin/env python3
"""Generate the C#, Java and layout-check sources from include/photon/photon.h.

Four hand-maintained copies of fifty-two signatures is four places for a struct
field to drift out of order, and a field in the wrong order is not a compile
error in any of them — it is silent data corruption at the boundary. So the
header is the only place any of this is written down, and everything else is
derived from it.

This is not a C parser. It does not need to be: photon.h is deliberately narrow
(pure C99, fixed-width scalars only, one typedef'd enum shape, descriptors that
start with struct_size), and a parser that understands exactly that much fails
loudly on anything else rather than guessing. If the header grows a construct
this does not know, the run stops.

Three outputs, and the third is the one that keeps the other two honest:

    bindings/csharp/Photon.g.cs      P/Invoke, Cdecl, sequential structs
    bindings/java/photon/Photon.java Panama FFM, explicit layouts
    tests/abi_layout_test.c          _Static_asserts on every field offset

The bindings compute their own field offsets from this script's model of the C
type system. That model could be wrong. The generated C file asserts every
offset it computed against what the compiler actually does, and it is built as
part of the test suite — so a wrong model is a failed build here, not a
corrupted struct in a host six months from now.

    python3 tools/generate_bindings.py [--check]

`--check` regenerates into memory and fails if the committed files differ,
which is what CI should run.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys
from dataclasses import dataclass, field

ROOT = pathlib.Path(__file__).resolve().parent.parent
HEADER = ROOT / "include" / "photon" / "photon.h"

# --------------------------------------------------------------------------
# The C type model
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Prim:
    size: int
    align: int
    csharp: str
    java_carrier: str
    java_layout: str


# Sizes and alignments are identical on every 64-bit target this ships to:
# System V x86-64/aarch64 and Windows x64 agree on all of these. That is the
# whole reason the header bans `int`, `long` and `size_t`.
PRIMITIVES: dict[str, Prim] = {
    "int8_t": Prim(1, 1, "sbyte", "byte", "JAVA_BYTE"),
    "uint8_t": Prim(1, 1, "byte", "byte", "JAVA_BYTE"),
    "int16_t": Prim(2, 2, "short", "short", "JAVA_SHORT"),
    "uint16_t": Prim(2, 2, "ushort", "short", "JAVA_SHORT"),
    "int32_t": Prim(4, 4, "int", "int", "JAVA_INT"),
    "uint32_t": Prim(4, 4, "uint", "int", "JAVA_INT"),
    "int64_t": Prim(8, 8, "long", "long", "JAVA_LONG"),
    "uint64_t": Prim(8, 8, "ulong", "long", "JAVA_LONG"),
    "float": Prim(4, 4, "float", "float", "JAVA_FLOAT"),
    "double": Prim(8, 8, "double", "double", "JAVA_DOUBLE"),
}

POINTER = Prim(8, 8, "IntPtr", "MemorySegment", "ADDRESS")


@dataclass
class StructDef:
    name: str
    fields: list[tuple[str, str]] = field(default_factory=list)  # (c_type, name)
    size: int = 0
    align: int = 1
    # (field name, offset) in declaration order, and the padding before each.
    offsets: list[tuple[str, int, int]] = field(default_factory=list)


@dataclass
class EnumDef:
    typedef: str | None
    constants: list[tuple[str, str]] = field(default_factory=list)


@dataclass
class FuncDef:
    ret: str
    name: str
    params: list[tuple[str, str]]  # (c_type, name)


@dataclass
class Api:
    abi_version: str = "1"
    aliases: dict[str, str] = field(default_factory=dict)  # ph_bool -> int32_t
    enums: list[EnumDef] = field(default_factory=list)
    #: Object-like PH_* macros with a plain numeric value — PH_NULL_HANDLE and
    #: PH_COLOR_AUTO. Sentinels, so they belong with the constants.
    defines: list[tuple[str, str]] = field(default_factory=list)
    structs: dict[str, StructDef] = field(default_factory=dict)
    struct_order: list[str] = field(default_factory=list)
    functions: list[FuncDef] = field(default_factory=list)
    callbacks: list[FuncDef] = field(default_factory=list)
    #: Function-pointer typedefs. Pointer-sized everywhere, and the only
    #: callbacks the ABI has — both of them set up once, by ph_init.
    callback_names: set[str] = field(default_factory=set)


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------


def strip_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    text = re.sub(r"//[^\n]*", " ", text)
    return text


def parse(header: str) -> Api:
    api = Api()
    source = strip_comments(header)

    match = re.search(r"#define\s+PHOTON_ABI_VERSION\s+(\d+)u?", source)
    if not match:
        raise SystemExit("photon.h: PHOTON_ABI_VERSION not found")
    api.abi_version = match.group(1)

    # typedef int32_t ph_mode;  /  typedef uint64_t ph_plot;
    for c_type, name in re.findall(r"typedef\s+(\w+)\s+(ph_\w+)\s*;", source):
        if c_type in PRIMITIVES:
            api.aliases[name] = c_type

    # typedef void* (PH_CALL* ph_proc_address_fn)(...);
    for ret, name, params in re.findall(
        r"typedef\s+([\w \*]+?)\s*\(\s*PH_CALL\s*\*\s*(ph_\w+)\s*\)\s*\((.*?)\)\s*;", source, re.S
    ):
        api.callbacks.append(FuncDef(ret.strip(), name, parse_params(params)))
        api.callback_names.add(name)

    for name, value in re.findall(
        r"#define\s+(PH_[A-Z0-9_]+)\s+(\(\(\w+\)\s*[\dxXa-fA-F]+\)|[\dxXa-fA-F]+u?)\s*$",
        source,
        re.M,
    ):
        api.defines.append((name, value))

    # Anonymous enums, each a block of NAME = value.
    for body in re.findall(r"\benum\s*\{(.*?)\}\s*;", source, re.S):
        entries: list[tuple[str, str]] = []
        for line in body.split(","):
            line = line.strip()
            if not line:
                continue
            key, _, value = line.partition("=")
            if not value:
                raise SystemExit(f"photon.h: enum entry without a value: {line!r}")
            entries.append((key.strip(), value.strip()))
        if entries:
            api.enums.append(EnumDef(None, entries))

    for body, name in re.findall(r"typedef\s+struct\s+\w+\s*\{(.*?)\}\s*(ph_\w+)\s*;", source, re.S):
        struct = StructDef(name)
        for raw in body.split(";"):
            decl = " ".join(raw.split())
            if not decl:
                continue
            c_type, field_name = split_declaration(decl)
            struct.fields.append((c_type, field_name))
        api.structs[name] = struct
        api.struct_order.append(name)

    for ret, name, params in re.findall(
        r"PH_API\s+([\w \*]+?)\s+PH_CALL\s+(ph_\w+)\s*\((.*?)\)\s*;", source, re.S
    ):
        api.functions.append(FuncDef(ret.strip(), name, parse_params(params)))

    return api


def split_declaration(decl: str) -> tuple[str, str]:
    """`const double* x` -> ("const double*", "x")."""
    if "[" in decl:
        raise SystemExit(f"photon.h: array members are not supported: {decl!r}")
    match = re.match(r"^(.*?)(\w+)$", decl)
    if not match:
        raise SystemExit(f"photon.h: cannot read declaration {decl!r}")
    c_type = match.group(1).strip()
    if not c_type:
        raise SystemExit(f"photon.h: declaration without a type: {decl!r}")
    return c_type, match.group(2)


def parse_params(text: str) -> list[tuple[str, str]]:
    text = " ".join(text.split())
    if text in ("", "void"):
        return []
    out: list[tuple[str, str]] = []
    for index, raw in enumerate(text.split(",")):
        decl = raw.strip()
        # A declaration with nothing but type tokens left after dropping `const`
        # and the stars is an unnamed parameter. `const char*` is unnamed;
        # `const char* name` and `ph_log_level level` are not.
        bare = decl.replace("const", " ").replace("*", " ").split()
        if len(bare) < 2:
            out.append((decl, f"arg{index}"))
            continue
        out.append(split_declaration(decl))
    return out


# --------------------------------------------------------------------------
# Layout
# --------------------------------------------------------------------------


def resolve(api: Api, c_type: str) -> tuple[int, int, str]:
    """(size, align, kind) for a field type. kind is prim | pointer | struct."""
    cleaned = c_type.replace("const", "").strip()
    if cleaned.endswith("*"):
        return POINTER.size, POINTER.align, "pointer"
    if cleaned in api.callback_names:
        return POINTER.size, POINTER.align, "pointer"
    cleaned = api.aliases.get(cleaned, cleaned)
    if cleaned in PRIMITIVES:
        prim = PRIMITIVES[cleaned]
        return prim.size, prim.align, "prim"
    if cleaned in api.structs:
        nested = api.structs[cleaned]
        return nested.size, nested.align, "struct"
    raise SystemExit(f"photon.h: unknown type {c_type!r}")


def lay_out(api: Api) -> None:
    """Fill in every struct's size, alignment and field offsets.

    Plain C rules, which every 64-bit ABI we target agrees on: a member sits at
    the next multiple of its own alignment, and the struct's size is rounded up
    to its strictest member's.
    """
    for name in api.struct_order:
        struct = api.structs[name]
        offset = 0
        align = 1
        for c_type, field_name in struct.fields:
            size, member_align, _ = resolve(api, c_type)
            padding = (-offset) % member_align
            offset += padding
            struct.offsets.append((field_name, offset, padding))
            offset += size
            align = max(align, member_align)
        struct.size = offset + (-offset) % align
        struct.align = align


# --------------------------------------------------------------------------
# C# emitter
# --------------------------------------------------------------------------

CS_KEYWORDS = {"base", "event", "in", "out", "ref", "params", "string", "object", "lock"}


def cs_name(name: str) -> str:
    return "@" + name if name in CS_KEYWORDS else name


def cs_field_type(api: Api, c_type: str) -> str:
    cleaned = c_type.replace("const", "").strip()
    if cleaned.endswith("*") or cleaned in api.callback_names:
        return "IntPtr"
    cleaned = api.aliases.get(cleaned, cleaned)
    if cleaned in PRIMITIVES:
        return PRIMITIVES[cleaned].csharp
    if cleaned in api.structs:
        return cleaned
    raise SystemExit(f"unknown field type {c_type!r}")


def is_array_param(api: Api, params: list[tuple[str, str]], index: int) -> bool:
    """Does `params[index]` point at an array rather than one value?

    The header spells an array as a `const T*` immediately followed by its
    count, and never spells anything else that way.
    """
    c_type, _ = params[index]
    if not c_type.strip().startswith("const") or not c_type.strip().endswith("*"):
        return False
    for next_type, next_name in params[index + 1 :]:
        if "count" in next_name:
            return True
        # Only a run of parallel arrays may sit between a pointer and its count.
        if not (next_type.strip().startswith("const") and next_type.strip().endswith("*")):
            return False
    return False


def cs_param(api: Api, c_type: str, name: str, array: bool = False) -> tuple[str, str]:
    """(attribute + type, name) for one P/Invoke parameter."""
    cleaned = " ".join(c_type.split())
    is_const = cleaned.startswith("const")
    base = cleaned.replace("const", "").strip()

    if base in ("char* *", "char**"):
        return "IntPtr", name
    if base == "char*":
        return "[MarshalAs(UnmanagedType.LPUTF8Str)] string", name
    if base in ("void*", "void"):
        return "IntPtr", name
    if base.endswith("*"):
        pointee = api.aliases.get(base[:-1].strip(), base[:-1].strip())
        if pointee in PRIMITIVES:
            cs = PRIMITIVES[pointee].csharp
            # A byte pointer is always a buffer here — the ABI never passes a
            # single byte out, and ph_plot_render_pixels is the only user.
            if pointee in ("uint8_t", "int8_t"):
                return f"{cs}[]", name
            # `const T*` is an input array; a bare `T*` is an out-parameter.
            return (f"{cs}[]" if is_const else f"out {cs}"), name
        if pointee in api.structs:
            if array:
                return f"{pointee}[]", name
            if not is_const:
                return f"out {pointee}", name
            # A single `const T*` stays an IntPtr here because almost all of
            # them accept NULL to mean "defaults", which `in` cannot express.
            # emit_csharp adds an `in T` overload alongside for the common case.
            return "IntPtr", name
        return "IntPtr", name

    if base in api.callback_names:
        return "IntPtr", name
    base = api.aliases.get(base, base)
    if base in PRIMITIVES:
        return PRIMITIVES[base].csharp, name
    if base in api.structs:
        return base, name
    raise SystemExit(f"unknown parameter type {c_type!r}")


def cs_return(api: Api, c_type: str) -> str:
    cleaned = c_type.replace("const", "").strip()
    if cleaned == "void":
        return "void"
    if cleaned.endswith("*"):
        return "IntPtr"
    cleaned = api.aliases.get(cleaned, cleaned)
    if cleaned in PRIMITIVES:
        return PRIMITIVES[cleaned].csharp
    raise SystemExit(f"unknown return type {c_type!r}")


def emit_csharp(api: Api) -> str:
    out: list[str] = []
    w = out.append
    w("// <auto-generated>")
    w("//   Generated by tools/generate_bindings.py from include/photon/photon.h.")
    w("//   Do not edit: regenerate instead. Field order here is load-bearing —")
    w("//   a member out of place is silent data corruption, not a compile error.")
    w("// </auto-generated>")
    w("")
    w("using System;")
    w("using System.Runtime.InteropServices;")
    w("")
    w("namespace Photon.Native;")
    w("")
    w("public static partial class Ph")
    w("{")
    w('    /// <summary>The shared library, without prefix or extension.</summary>')
    w('    public const string Library = "photon";')
    w("")
    w("    /// <summary>")
    w("    ///   Mandatory. .NET defaults to StdCall on 32-bit Windows, and the")
    w("    ///   library is cdecl everywhere.")
    w("    /// </summary>")
    w("    private const CallingConvention Cc = CallingConvention.Cdecl;")
    w("")
    w(f"    public const uint AbiVersion = {api.abi_version};")
    w("")

    # The C names verbatim rather than PascalCase: this layer is a faithful
    # mirror of the header, and a second naming system is a second thing to be
    # wrong about. The idiomatic wrapper belongs above it.
    for name, value in api.defines:
        kind, literal = constant_value(value, java=False)
        w(f"    public const {kind} {name} = {literal};")
    for enum in api.enums:
        for name, value in enum.constants:
            kind, literal = constant_value(value, java=False)
            w(f"    public const {kind} {name} = {literal};")
    w("")

    for callback in api.callbacks:
        params = ", ".join(
            f"{cs_param(api, t, n)[0]} {cs_name(n)}" for t, n in callback.params
        )
        w("    [UnmanagedFunctionPointer(Cc)]")
        w(f"    public delegate {cs_return(api, callback.ret)} {pascal(callback.name)}({params});")
        w("")

    for name in api.struct_order:
        struct = api.structs[name]
        w(f"    /// <summary>{name} — {struct.size} bytes, alignment {struct.align}.</summary>")
        w("    [StructLayout(LayoutKind.Sequential)]")
        w(f"    public struct {name}")
        w("    {")
        for (c_type, field_name), (_, offset, _) in zip(struct.fields, struct.offsets):
            w(f"        /// <summary>offset {offset}</summary>")
            w(f"        public {cs_field_type(api, c_type)} {cs_name(field_name)};")
        w("    }")
        w("")

    w("    /// <summary>")
    w("    ///   Every function in the ABI, by name — so a binding-level test can")
    w("    ///   assert it exercised all of them rather than merely intending to.")
    w("    /// </summary>")
    w("    public static readonly string[] EntryPoints = {")
    for func in api.functions:
        w(f'        "{func.name}",')
    w("    };")
    w("")

    for func in api.functions:
        def render(overload: bool) -> str:
            pieces = []
            for index, (c_type, param) in enumerate(func.params):
                array = is_array_param(api, func.params, index)
                cs, _ = cs_param(api, c_type, param, array)
                if overload and cs == "IntPtr" and not array:
                    pointee = c_type.replace("const", "").strip().rstrip("*").strip()
                    if pointee in api.structs:
                        cs = f"in {pointee}"
                pieces.append(f"{cs} {cs_name(param)}")
            return ", ".join(pieces)

        plain = render(overload=False)
        w(f'    [DllImport(Library, CallingConvention = Cc, EntryPoint = "{func.name}")]')
        w(f"    public static extern {cs_return(api, func.ret)} {func.name}({plain});")
        w("")
        # A second declaration taking the descriptor by reference, for the usual
        # case where the caller has one and is not passing NULL.
        typed = render(overload=True)
        if typed != plain:
            w(f'    [DllImport(Library, CallingConvention = Cc, EntryPoint = "{func.name}")]')
            w(f"    public static extern {cs_return(api, func.ret)} {func.name}({typed});")
            w("")

    w("}")
    return "\n".join(out).rstrip() + "\n"


def constant_value(value: str, java: bool) -> tuple[str, str]:
    """(kind, literal) for a constant, in C# or Java spelling."""
    text = value.strip()
    wide = "uint64_t" in text
    text = re.sub(r"\(\(\w+\)\s*([\dxXa-fA-F]+)\)", r"\1", text)
    text = re.sub(r"1\s*<<\s*(\d+)", lambda m: str(1 << int(m.group(1))), text)
    text = text.rstrip("uU")
    if wide:
        return ("long", text + "L") if java else ("ulong", text + "UL")
    return ("int", text)


def pascal(name: str) -> str:
    return "".join(part.capitalize() for part in name.split("_"))


# --------------------------------------------------------------------------
# Java emitter
# --------------------------------------------------------------------------

JAVA_KEYWORDS = {"native", "new", "class", "int", "float", "double", "long", "short", "byte"}


def java_name(name: str) -> str:
    return name + "_" if name in JAVA_KEYWORDS else name


def java_layout(api: Api, c_type: str) -> str:
    cleaned = c_type.replace("const", "").strip()
    if cleaned.endswith("*") or cleaned in api.callback_names:
        return "ValueLayout.ADDRESS"
    cleaned = api.aliases.get(cleaned, cleaned)
    if cleaned in PRIMITIVES:
        return f"ValueLayout.{PRIMITIVES[cleaned].java_layout}"
    if cleaned in api.structs:
        return f"{cleaned}.LAYOUT"
    raise SystemExit(f"unknown java layout for {c_type!r}")


def java_carrier(api: Api, c_type: str) -> str:
    cleaned = c_type.replace("const", "").strip()
    if cleaned.endswith("*") or cleaned in api.callback_names:
        return "MemorySegment"
    cleaned = api.aliases.get(cleaned, cleaned)
    if cleaned in PRIMITIVES:
        return PRIMITIVES[cleaned].java_carrier
    if cleaned in api.structs:
        return "MemorySegment"
    if cleaned == "void":
        return "void"
    raise SystemExit(f"unknown java carrier for {c_type!r}")


def emit_java(api: Api) -> str:
    out: list[str] = []
    w = out.append
    w("// Generated by tools/generate_bindings.py from include/photon/photon.h.")
    w("// Do not edit: regenerate instead. Every offset below is computed from the")
    w("// header and asserted against the C compiler by tests/abi_layout_test.c.")
    w("package photon;")
    w("")
    w("import java.lang.foreign.Arena;")
    w("import java.lang.foreign.FunctionDescriptor;")
    w("import java.lang.foreign.Linker;")
    w("import java.lang.foreign.MemoryLayout;")
    w("import java.lang.foreign.MemorySegment;")
    w("import java.lang.foreign.SymbolLookup;")
    w("import java.lang.foreign.ValueLayout;")
    w("import java.lang.invoke.MethodHandle;")
    w("")
    w("/**")
    w(" * The Photon C ABI, through Panama's foreign function API (JDK 22+).")
    w(" *")
    w(" * Handles are plain longs and descriptors are {@link MemorySegment}s laid out")
    w(" * by the nested layout classes. Arrays are copied by the library during the")
    w(" * call, so nothing here has to stay reachable afterwards.")
    w(" */")
    w("public final class Photon {")
    w("    private Photon() {}")
    w("")
    w(f"    public static final int ABI_VERSION = {api.abi_version};")
    w("")
    w("    private static final Linker LINKER = Linker.nativeLinker();")
    w("    private static final SymbolLookup LOOKUP = loadLibrary();")
    w("")
    w("    private static SymbolLookup loadLibrary() {")
    w('        String override = System.getProperty("photon.library");')
    w("        Arena arena = Arena.global();")
    w("        if (override != null) {")
    w("            return SymbolLookup.libraryLookup(java.nio.file.Path.of(override), arena);")
    w("        }")
    w('        return SymbolLookup.libraryLookup(System.mapLibraryName("photon"), arena);')
    w("    }")
    w("")
    w("    private static MethodHandle handle(String name, FunctionDescriptor descriptor) {")
    w("        return LINKER.downcallHandle(")
    w("            LOOKUP.find(name).orElseThrow(")
    w('                () -> new UnsatisfiedLinkError("photon: missing symbol " + name)),')
    w("            descriptor);")
    w("    }")
    w("")

    w("    // ---- constants ----")
    w("")
    for name, value in api.defines:
        kind, literal = constant_value(value, java=True)
        w(f"    public static final {kind} {name} = {literal};")
    for enum in api.enums:
        for name, value in enum.constants:
            kind, literal = constant_value(value, java=True)
            w(f"    public static final {kind} {name} = {literal};")
    w("")

    w("    // ---- descriptor layouts ----")
    w("")
    for name in api.struct_order:
        struct = api.structs[name]
        w(f"    /** {name} — {struct.size} bytes, alignment {struct.align}. */")
        w(f"    public static final class {name} {{")
        w(f"        private {name}() {{}}")
        w("")
        w("        public static final MemoryLayout LAYOUT = MemoryLayout.structLayout(")
        pieces: list[str] = []
        for (c_type, field_name), (_, _, padding) in zip(struct.fields, struct.offsets):
            if padding:
                pieces.append(f"MemoryLayout.paddingLayout({padding})")
            pieces.append(f'{java_layout(api, c_type)}.withName("{field_name}")')
        tail = struct.size - (struct.offsets[-1][1] + resolve(api, struct.fields[-1][0])[0])
        if tail:
            pieces.append(f"MemoryLayout.paddingLayout({tail})")
        for index, piece in enumerate(pieces):
            comma = "," if index + 1 < len(pieces) else ""
            w(f"            {piece}{comma}")
        w(f'        ).withName("{name}");')
        w("")
        w("        public static final long SIZE = LAYOUT.byteSize();")
        w("")
        # OFFSET_-prefixed so a field called `size` cannot collide with the
        # struct's own SIZE, which is exactly what ph_scatter_desc does.
        for (c_type, field_name), (_, offset, _) in zip(struct.fields, struct.offsets):
            w(f"        public static final long OFFSET_{field_name.upper()} = {offset}L;")
        w("")
        w("        /** Allocate one, zero-filled — which the ABI defines as all defaults. */")
        w("        public static MemorySegment allocate(Arena arena) {")
        w("            return arena.allocate(LAYOUT);")
        w("        }")
        w("    }")
        w("")

    w("    // ---- entry points ----")
    w("")
    w("    /**")
    w("     * Every function in the ABI, by name.")
    w("     *")
    w("     * So that a binding-level test can assert it exercised all of them")
    w("     * rather than merely intending to.")
    w("     */")
    w("    public static final String[] ENTRY_POINTS = {")
    for func in api.functions:
        w(f'        "{func.name}",')
    w("    };")
    w("")
    for func in api.functions:
        args = ", ".join(java_layout(api, t) for t, _ in func.params)
        if func.ret == "void":
            descriptor = f"FunctionDescriptor.ofVoid({args})"
        else:
            ret_layout = java_layout(api, func.ret)
            descriptor = f"FunctionDescriptor.of({ret_layout}{', ' + args if args else ''})"
        upper = func.name.upper()
        w(f'    private static final MethodHandle {upper} = handle("{func.name}", {descriptor});')
    w("")

    for func in api.functions:
        ret = java_carrier(api, func.ret)
        params = ", ".join(f"{java_carrier(api, t)} {java_name(n)}" for t, n in func.params)
        call_args = ", ".join(java_name(n) for _, n in func.params)
        upper = func.name.upper()
        w(f"    public static {ret} {func.name}({params}) {{")
        w("        try {")
        if ret == "void":
            w(f"            {upper}.invokeExact({call_args});")
        else:
            w(f"            return ({ret}) {upper}.invokeExact({call_args});")
        # Not `t`: a C parameter may well be called that, and then the catch
        # variable shadows it and the whole binding stops compiling.
        w("        } catch (Throwable photonFailure) {")
        w(f'            throw new AssertionError("photon: {func.name} failed", photonFailure);')
        w("        }")
        w("    }")
        w("")

    # Every `const char*` the ABI returns arrives as a zero-length segment,
    # because the JVM cannot know how long it is; reinterpret first or getString
    # refuses to read a byte.
    w("    /** A `const char*` the ABI returned, or null for NULL. */")
    w("    public static String string(MemorySegment text) {")
    w("        if (text == null || text.equals(MemorySegment.NULL)) return null;")
    w("        return text.reinterpret(Long.MAX_VALUE).getString(0);")
    w("    }")
    w("")
    w("    /** The last error on this thread, or an empty string. */")
    w("    public static String lastError() {")
    w("        MemorySegment message = ph_last_error();")
    w('        if (message.equals(MemorySegment.NULL)) return "";')
    w("        return message.reinterpret(Long.MAX_VALUE).getString(0);")
    w("    }")
    w("}")
    return "\n".join(out).rstrip() + "\n"


# --------------------------------------------------------------------------
# The layout check, in C
# --------------------------------------------------------------------------


def emit_layout_check(api: Api) -> str:
    out: list[str] = []
    w = out.append
    w("/*")
    w(" * Generated by tools/generate_bindings.py from include/photon/photon.h.")
    w(" * Do not edit: regenerate instead.")
    w(" *")
    w(" * The C# and Java bindings place every field by an offset this generator")
    w(" * computed from its own model of the C type system. That model could be")
    w(" * wrong, and if it is, nothing in either language would say so — a struct")
    w(" * field read at the wrong offset is a plausible-looking number, not a")
    w(" * crash. So every offset the generator computed is asserted here against")
    w(" * what the compiler actually does, and this file is built as part of the")
    w(" * test suite. A wrong model fails the build here rather than corrupting a")
    w(" * descriptor in a host months later.")
    w(" */")
    w("")
    w("#include <photon/photon.h>")
    w("#include <stddef.h>")
    w("#include <stdint.h>")
    w("#include <stdio.h>")
    w("")
    w("/* The rest of the suite builds as C99; this one file needs C11, for")
    w(" * _Static_assert and _Alignof. CMake asks for it. */")
    w("#if !defined(__STDC_VERSION__) || __STDC_VERSION__ < 201112L")
    w('#  error "abi_layout_test.c needs C11"')
    w("#endif")
    w("#define PH_ASSERT_LAYOUT(cond, message) _Static_assert(cond, message)")
    w("")
    w("/* Every size below assumes a 64-bit target, which is what the bindings")
    w(" * assume too. A 32-bit build would need its own generated pair. */")
    w("#if UINTPTR_MAX == 0xFFFFFFFFFFFFFFFFu")
    w("")
    for name in api.struct_order:
        struct = api.structs[name]
        w(f'PH_ASSERT_LAYOUT(sizeof({name}) == {struct.size}, "{name} size");')
        w(f'PH_ASSERT_LAYOUT(_Alignof({name}) == {struct.align}, "{name} alignment");')
        for field_name, offset, _ in struct.offsets:
            w(
                f"PH_ASSERT_LAYOUT(offsetof({name}, {field_name}) == {offset}, "
                f'"{name}.{field_name} offset");'
            )
        w("")
    w("#endif  /* 64-bit */")
    w("")
    w("int main(void) {")
    w("#if UINTPTR_MAX == 0xFFFFFFFFFFFFFFFFu")
    w(f'  printf("%d struct layouts match the generated bindings\\n", {len(api.struct_order)});')
    w("  return 0;")
    w("#else")
    w('  printf("SKIP: not a 64-bit target\\n");')
    w("  return 77;")
    w("#endif")
    w("}")
    return "\n".join(out).rstrip() + "\n"


# --------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check", action="store_true", help="fail if the committed files are out of date"
    )
    args = parser.parse_args()

    api = parse(HEADER.read_text(encoding="utf-8"))
    lay_out(api)

    outputs = {
        ROOT / "bindings" / "csharp" / "Photon.g.cs": emit_csharp(api),
        ROOT / "bindings" / "java" / "photon" / "Photon.java": emit_java(api),
        ROOT / "tests" / "abi_layout_test.c": emit_layout_check(api),
    }

    stale = []
    for path, content in outputs.items():
        if args.check:
            current = path.read_text(encoding="utf-8") if path.exists() else ""
            if current != content:
                stale.append(path)
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)}")

    if args.check:
        if stale:
            for path in stale:
                print(f"out of date: {path.relative_to(ROOT)}", file=sys.stderr)
            print("run: python3 tools/generate_bindings.py", file=sys.stderr)
            return 1
        print("bindings are up to date")
        return 0

    print(
        f"{len(api.structs)} structs, {len(api.functions)} functions, "
        f"{sum(len(e.constants) for e in api.enums)} constants"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
