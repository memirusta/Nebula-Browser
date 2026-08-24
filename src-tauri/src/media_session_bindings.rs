#![cfg(target_os = "windows")]
#![allow(non_snake_case)]

use core::ffi::c_void;
use windows::Foundation::{TypedEventHandler, Uri};
use windows::Win32::Foundation::HWND;
use windows_core::{Interface, Result, RuntimeName, RuntimeType, Type, GUID, HRESULT, HSTRING};

#[repr(transparent)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct MediaPlaybackStatus(pub i32);

impl MediaPlaybackStatus {
    pub const CLOSED: Self = Self(0);
    pub const PLAYING: Self = Self(3);
    pub const PAUSED: Self = Self(4);
}

impl windows_core::TypeKind for MediaPlaybackStatus {
    type TypeKind = windows_core::CopyType;
}

impl RuntimeType for MediaPlaybackStatus {
    const SIGNATURE: windows_core::imp::ConstBuffer =
        windows_core::imp::ConstBuffer::from_slice(b"enum(Windows.Media.MediaPlaybackStatus;i4)");
}

#[repr(transparent)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct MediaPlaybackType(pub i32);

impl MediaPlaybackType {
    pub const MUSIC: Self = Self(1);
}

impl windows_core::TypeKind for MediaPlaybackType {
    type TypeKind = windows_core::CopyType;
}

impl RuntimeType for MediaPlaybackType {
    const SIGNATURE: windows_core::imp::ConstBuffer =
        windows_core::imp::ConstBuffer::from_slice(b"enum(Windows.Media.MediaPlaybackType;i4)");
}

#[repr(transparent)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct SystemMediaTransportControlsButton(pub i32);

impl SystemMediaTransportControlsButton {
    pub const PLAY: Self = Self(0);
    pub const PAUSE: Self = Self(1);
}

impl windows_core::TypeKind for SystemMediaTransportControlsButton {
    type TypeKind = windows_core::CopyType;
}

impl RuntimeType for SystemMediaTransportControlsButton {
    const SIGNATURE: windows_core::imp::ConstBuffer = windows_core::imp::ConstBuffer::from_slice(
        b"enum(Windows.Media.SystemMediaTransportControlsButton;i4)",
    );
}

#[repr(transparent)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct SoundLevel(i32);

windows_core::imp::define_interface!(
    ISystemMediaTransportControlsInterop,
    ISystemMediaTransportControlsInterop_Vtbl,
    0xddb0472d_c911_4a1f_86d9_dc3d71a95f5a
);

#[repr(C)]
pub struct ISystemMediaTransportControlsInterop_Vtbl {
    base__: windows_core::IInspectable_Vtbl,
    GetForWindow:
        unsafe extern "system" fn(*mut c_void, HWND, *const GUID, *mut *mut c_void) -> HRESULT,
}

windows_core::imp::define_interface!(
    ISystemMediaTransportControls,
    ISystemMediaTransportControls_Vtbl,
    0x99fa3ff4_1742_42a6_902e_087d41f965ec
);

impl RuntimeType for ISystemMediaTransportControls {
    const SIGNATURE: windows_core::imp::ConstBuffer =
        windows_core::imp::ConstBuffer::for_interface::<Self>();
}

#[repr(C)]
pub struct ISystemMediaTransportControls_Vtbl {
    base__: windows_core::IInspectable_Vtbl,
    PlaybackStatus: unsafe extern "system" fn(*mut c_void, *mut MediaPlaybackStatus) -> HRESULT,
    SetPlaybackStatus: unsafe extern "system" fn(*mut c_void, MediaPlaybackStatus) -> HRESULT,
    DisplayUpdater: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT,
    SoundLevel: unsafe extern "system" fn(*mut c_void, *mut SoundLevel) -> HRESULT,
    IsEnabled: unsafe extern "system" fn(*mut c_void, *mut bool) -> HRESULT,
    SetIsEnabled: unsafe extern "system" fn(*mut c_void, bool) -> HRESULT,
    IsPlayEnabled: unsafe extern "system" fn(*mut c_void, *mut bool) -> HRESULT,
    SetIsPlayEnabled: unsafe extern "system" fn(*mut c_void, bool) -> HRESULT,
    IsStopEnabled: unsafe extern "system" fn(*mut c_void, *mut bool) -> HRESULT,
    SetIsStopEnabled: unsafe extern "system" fn(*mut c_void, bool) -> HRESULT,
    IsPauseEnabled: unsafe extern "system" fn(*mut c_void, *mut bool) -> HRESULT,
    SetIsPauseEnabled: unsafe extern "system" fn(*mut c_void, bool) -> HRESULT,
    IsRecordEnabled: unsafe extern "system" fn(*mut c_void, *mut bool) -> HRESULT,
    SetIsRecordEnabled: unsafe extern "system" fn(*mut c_void, bool) -> HRESULT,
    IsFastForwardEnabled: unsafe extern "system" fn(*mut c_void, *mut bool) -> HRESULT,
    SetIsFastForwardEnabled: unsafe extern "system" fn(*mut c_void, bool) -> HRESULT,
    IsRewindEnabled: unsafe extern "system" fn(*mut c_void, *mut bool) -> HRESULT,
    SetIsRewindEnabled: unsafe extern "system" fn(*mut c_void, bool) -> HRESULT,
    IsPreviousEnabled: unsafe extern "system" fn(*mut c_void, *mut bool) -> HRESULT,
    SetIsPreviousEnabled: unsafe extern "system" fn(*mut c_void, bool) -> HRESULT,
    IsNextEnabled: unsafe extern "system" fn(*mut c_void, *mut bool) -> HRESULT,
    SetIsNextEnabled: unsafe extern "system" fn(*mut c_void, bool) -> HRESULT,
    IsChannelUpEnabled: unsafe extern "system" fn(*mut c_void, *mut bool) -> HRESULT,
    SetIsChannelUpEnabled: unsafe extern "system" fn(*mut c_void, bool) -> HRESULT,
    IsChannelDownEnabled: unsafe extern "system" fn(*mut c_void, *mut bool) -> HRESULT,
    SetIsChannelDownEnabled: unsafe extern "system" fn(*mut c_void, bool) -> HRESULT,
    ButtonPressed: unsafe extern "system" fn(*mut c_void, *mut c_void, *mut i64) -> HRESULT,
    RemoveButtonPressed: unsafe extern "system" fn(*mut c_void, i64) -> HRESULT,
    PropertyChanged: unsafe extern "system" fn(*mut c_void, *mut c_void, *mut i64) -> HRESULT,
    RemovePropertyChanged: unsafe extern "system" fn(*mut c_void, i64) -> HRESULT,
}

windows_core::imp::define_interface!(
    ISystemMediaTransportControlsButtonPressedEventArgs,
    ISystemMediaTransportControlsButtonPressedEventArgs_Vtbl,
    0xb7f47116_a56f_4dc8_9e11_92031f4a87c2
);

impl RuntimeType for ISystemMediaTransportControlsButtonPressedEventArgs {
    const SIGNATURE: windows_core::imp::ConstBuffer =
        windows_core::imp::ConstBuffer::for_interface::<Self>();
}

#[repr(C)]
pub struct ISystemMediaTransportControlsButtonPressedEventArgs_Vtbl {
    base__: windows_core::IInspectable_Vtbl,
    Button:
        unsafe extern "system" fn(*mut c_void, *mut SystemMediaTransportControlsButton) -> HRESULT,
}

windows_core::imp::define_interface!(
    ISystemMediaTransportControlsDisplayUpdater,
    ISystemMediaTransportControlsDisplayUpdater_Vtbl,
    0x8abbc53e_fa55_4ecf_ad8e_c984e5dd1550
);

impl RuntimeType for ISystemMediaTransportControlsDisplayUpdater {
    const SIGNATURE: windows_core::imp::ConstBuffer =
        windows_core::imp::ConstBuffer::for_interface::<Self>();
}

#[repr(C)]
pub struct ISystemMediaTransportControlsDisplayUpdater_Vtbl {
    base__: windows_core::IInspectable_Vtbl,
    Type: unsafe extern "system" fn(*mut c_void, *mut MediaPlaybackType) -> HRESULT,
    SetType: unsafe extern "system" fn(*mut c_void, MediaPlaybackType) -> HRESULT,
    AppMediaId: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT,
    SetAppMediaId: unsafe extern "system" fn(*mut c_void, *mut c_void) -> HRESULT,
    Thumbnail: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT,
    SetThumbnail: unsafe extern "system" fn(*mut c_void, *mut c_void) -> HRESULT,
    MusicProperties: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT,
    VideoProperties: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT,
    ImageProperties: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT,
    CopyFromFileAsync: unsafe extern "system" fn(
        *mut c_void,
        MediaPlaybackType,
        *mut c_void,
        *mut *mut c_void,
    ) -> HRESULT,
    ClearAll: unsafe extern "system" fn(*mut c_void) -> HRESULT,
    Update: unsafe extern "system" fn(*mut c_void) -> HRESULT,
}

windows_core::imp::define_interface!(
    IMusicDisplayProperties,
    IMusicDisplayProperties_Vtbl,
    0x6bbf0c59_d0a0_4d26_92a0_f978e1d18e7b
);

impl RuntimeType for IMusicDisplayProperties {
    const SIGNATURE: windows_core::imp::ConstBuffer =
        windows_core::imp::ConstBuffer::for_interface::<Self>();
}

#[repr(C)]
pub struct IMusicDisplayProperties_Vtbl {
    base__: windows_core::IInspectable_Vtbl,
    Title: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT,
    SetTitle: unsafe extern "system" fn(*mut c_void, *mut c_void) -> HRESULT,
    AlbumArtist: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT,
    SetAlbumArtist: unsafe extern "system" fn(*mut c_void, *mut c_void) -> HRESULT,
    Artist: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT,
    SetArtist: unsafe extern "system" fn(*mut c_void, *mut c_void) -> HRESULT,
}

windows_core::imp::define_interface!(
    IMusicDisplayProperties2,
    IMusicDisplayProperties2_Vtbl,
    0x00368462_97d3_44b9_b00f_008afcefaf18
);

#[repr(C)]
pub struct IMusicDisplayProperties2_Vtbl {
    base__: windows_core::IInspectable_Vtbl,
    AlbumTitle: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT,
    SetAlbumTitle: unsafe extern "system" fn(*mut c_void, *mut c_void) -> HRESULT,
    TrackNumber: unsafe extern "system" fn(*mut c_void, *mut u32) -> HRESULT,
    SetTrackNumber: unsafe extern "system" fn(*mut c_void, u32) -> HRESULT,
    Genres: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT,
}

windows_core::imp::define_interface!(
    IRandomAccessStreamReference,
    IRandomAccessStreamReference_Vtbl,
    0x33ee3134_1dd6_4e3a_8067_d1c162e8642b
);

impl RuntimeType for IRandomAccessStreamReference {
    const SIGNATURE: windows_core::imp::ConstBuffer =
        windows_core::imp::ConstBuffer::for_interface::<Self>();
}

#[repr(C)]
pub struct IRandomAccessStreamReference_Vtbl {
    base__: windows_core::IInspectable_Vtbl,
    OpenReadAsync: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT,
}

windows_core::imp::define_interface!(
    IRandomAccessStreamReferenceStatics,
    IRandomAccessStreamReferenceStatics_Vtbl,
    0x857309dc_3fbf_4e7d_986f_ef3b1a07a964
);

#[repr(C)]
pub struct IRandomAccessStreamReferenceStatics_Vtbl {
    base__: windows_core::IInspectable_Vtbl,
    CreateFromFile:
        unsafe extern "system" fn(*mut c_void, *mut c_void, *mut *mut c_void) -> HRESULT,
    CreateFromUri: unsafe extern "system" fn(*mut c_void, *mut c_void, *mut *mut c_void) -> HRESULT,
    CreateFromStream:
        unsafe extern "system" fn(*mut c_void, *mut c_void, *mut *mut c_void) -> HRESULT,
}

#[repr(transparent)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SystemMediaTransportControls(windows_core::IUnknown);

windows_core::imp::interface_hierarchy!(
    SystemMediaTransportControls,
    windows_core::IUnknown,
    windows_core::IInspectable
);

impl RuntimeType for SystemMediaTransportControls {
    const SIGNATURE: windows_core::imp::ConstBuffer =
        windows_core::imp::ConstBuffer::for_class::<Self, ISystemMediaTransportControls>();
}

unsafe impl Interface for SystemMediaTransportControls {
    type Vtable = ISystemMediaTransportControls_Vtbl;
    const IID: GUID = ISystemMediaTransportControls::IID;
}

impl RuntimeName for SystemMediaTransportControls {
    const NAME: &'static str = "Windows.Media.SystemMediaTransportControls";
}

unsafe impl Send for SystemMediaTransportControls {}
unsafe impl Sync for SystemMediaTransportControls {}

impl SystemMediaTransportControls {
    pub fn for_window(hwnd: HWND) -> Result<Self> {
        let factory = windows_core::factory::<Self, ISystemMediaTransportControlsInterop>()?;
        unsafe {
            let mut result = core::ptr::null_mut();
            (Interface::vtable(&factory).GetForWindow)(
                Interface::as_raw(&factory),
                hwnd,
                &Self::IID,
                &mut result,
            )
            .and_then(|| Type::from_abi(result))
        }
    }

    pub fn set_enabled(&self, value: bool) -> Result<()> {
        unsafe { (Interface::vtable(self).SetIsEnabled)(Interface::as_raw(self), value).ok() }
    }

    pub fn set_play_enabled(&self, value: bool) -> Result<()> {
        unsafe { (Interface::vtable(self).SetIsPlayEnabled)(Interface::as_raw(self), value).ok() }
    }

    pub fn set_pause_enabled(&self, value: bool) -> Result<()> {
        unsafe { (Interface::vtable(self).SetIsPauseEnabled)(Interface::as_raw(self), value).ok() }
    }

    pub fn set_playback_status(&self, value: MediaPlaybackStatus) -> Result<()> {
        unsafe { (Interface::vtable(self).SetPlaybackStatus)(Interface::as_raw(self), value).ok() }
    }

    pub fn display_updater(&self) -> Result<SystemMediaTransportControlsDisplayUpdater> {
        unsafe {
            let mut result = core::ptr::null_mut();
            (Interface::vtable(self).DisplayUpdater)(Interface::as_raw(self), &mut result)
                .and_then(|| Type::from_abi(result))
        }
    }

    pub fn add_button_pressed(
        &self,
        handler: &TypedEventHandler<Self, SystemMediaTransportControlsButtonPressedEventArgs>,
    ) -> Result<i64> {
        unsafe {
            let mut token = 0;
            (Interface::vtable(self).ButtonPressed)(
                Interface::as_raw(self),
                Interface::as_raw(handler),
                &mut token,
            )
            .map(|| token)
        }
    }

    pub fn remove_button_pressed(&self, token: i64) -> Result<()> {
        unsafe {
            (Interface::vtable(self).RemoveButtonPressed)(Interface::as_raw(self), token).ok()
        }
    }
}

#[repr(transparent)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SystemMediaTransportControlsButtonPressedEventArgs(windows_core::IUnknown);

windows_core::imp::interface_hierarchy!(
    SystemMediaTransportControlsButtonPressedEventArgs,
    windows_core::IUnknown,
    windows_core::IInspectable
);

impl RuntimeType for SystemMediaTransportControlsButtonPressedEventArgs {
    const SIGNATURE: windows_core::imp::ConstBuffer = windows_core::imp::ConstBuffer::for_class::<
        Self,
        ISystemMediaTransportControlsButtonPressedEventArgs,
    >();
}

unsafe impl Interface for SystemMediaTransportControlsButtonPressedEventArgs {
    type Vtable = ISystemMediaTransportControlsButtonPressedEventArgs_Vtbl;
    const IID: GUID = ISystemMediaTransportControlsButtonPressedEventArgs::IID;
}

impl RuntimeName for SystemMediaTransportControlsButtonPressedEventArgs {
    const NAME: &'static str = "Windows.Media.SystemMediaTransportControlsButtonPressedEventArgs";
}

impl SystemMediaTransportControlsButtonPressedEventArgs {
    pub fn button(&self) -> Result<SystemMediaTransportControlsButton> {
        unsafe {
            let mut result = SystemMediaTransportControlsButton::default();
            (Interface::vtable(self).Button)(Interface::as_raw(self), &mut result).map(|| result)
        }
    }
}

#[repr(transparent)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SystemMediaTransportControlsDisplayUpdater(windows_core::IUnknown);

windows_core::imp::interface_hierarchy!(
    SystemMediaTransportControlsDisplayUpdater,
    windows_core::IUnknown,
    windows_core::IInspectable
);

unsafe impl Interface for SystemMediaTransportControlsDisplayUpdater {
    type Vtable = ISystemMediaTransportControlsDisplayUpdater_Vtbl;
    const IID: GUID = ISystemMediaTransportControlsDisplayUpdater::IID;
}

impl SystemMediaTransportControlsDisplayUpdater {
    pub fn clear_all(&self) -> Result<()> {
        unsafe { (Interface::vtable(self).ClearAll)(Interface::as_raw(self)).ok() }
    }

    pub fn set_type(&self, value: MediaPlaybackType) -> Result<()> {
        unsafe { (Interface::vtable(self).SetType)(Interface::as_raw(self), value).ok() }
    }

    pub fn music_properties(&self) -> Result<MusicDisplayProperties> {
        unsafe {
            let mut result = core::ptr::null_mut();
            (Interface::vtable(self).MusicProperties)(Interface::as_raw(self), &mut result)
                .and_then(|| Type::from_abi(result))
        }
    }

    pub fn set_thumbnail(&self, value: Option<&RandomAccessStreamReference>) -> Result<()> {
        unsafe {
            let raw = value
                .map(Interface::as_raw)
                .unwrap_or(core::ptr::null_mut());
            (Interface::vtable(self).SetThumbnail)(Interface::as_raw(self), raw).ok()
        }
    }

    pub fn update(&self) -> Result<()> {
        unsafe { (Interface::vtable(self).Update)(Interface::as_raw(self)).ok() }
    }
}

#[repr(transparent)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MusicDisplayProperties(windows_core::IUnknown);

windows_core::imp::interface_hierarchy!(
    MusicDisplayProperties,
    windows_core::IUnknown,
    windows_core::IInspectable
);

unsafe impl Interface for MusicDisplayProperties {
    type Vtable = IMusicDisplayProperties_Vtbl;
    const IID: GUID = IMusicDisplayProperties::IID;
}

impl MusicDisplayProperties {
    fn set_string(
        &self,
        value: &str,
        setter: unsafe extern "system" fn(*mut c_void, *mut c_void) -> HRESULT,
    ) -> Result<()> {
        let value = HSTRING::from(value);
        unsafe { setter(Interface::as_raw(self), core::mem::transmute_copy(&value)).ok() }
    }

    pub fn set_title(&self, value: &str) -> Result<()> {
        self.set_string(value, Interface::vtable(self).SetTitle)
    }

    pub fn set_artist(&self, value: &str) -> Result<()> {
        self.set_string(value, Interface::vtable(self).SetArtist)
    }

    pub fn set_album(&self, value: &str) -> Result<()> {
        let properties = Interface::cast::<IMusicDisplayProperties2>(self)?;
        let value = HSTRING::from(value);
        unsafe {
            (Interface::vtable(&properties).SetAlbumTitle)(
                Interface::as_raw(&properties),
                core::mem::transmute_copy(&value),
            )
            .ok()
        }
    }
}

#[repr(transparent)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RandomAccessStreamReference(windows_core::IUnknown);

windows_core::imp::interface_hierarchy!(
    RandomAccessStreamReference,
    windows_core::IUnknown,
    windows_core::IInspectable,
    IRandomAccessStreamReference
);

unsafe impl Interface for RandomAccessStreamReference {
    type Vtable = IRandomAccessStreamReference_Vtbl;
    const IID: GUID = IRandomAccessStreamReference::IID;
}

impl RuntimeName for RandomAccessStreamReference {
    const NAME: &'static str = "Windows.Storage.Streams.RandomAccessStreamReference";
}

impl RandomAccessStreamReference {
    pub fn from_uri(uri: &Uri) -> Result<Self> {
        let factory = windows_core::factory::<Self, IRandomAccessStreamReferenceStatics>()?;
        unsafe {
            let mut result = core::ptr::null_mut();
            (Interface::vtable(&factory).CreateFromUri)(
                Interface::as_raw(&factory),
                Interface::as_raw(uri),
                &mut result,
            )
            .and_then(|| Type::from_abi(result))
        }
    }
}
