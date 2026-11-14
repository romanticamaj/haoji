if(NOT TARGET react-native-nitro-modules::NitroModules)
add_library(react-native-nitro-modules::NitroModules SHARED IMPORTED)
set_target_properties(react-native-nitro-modules::NitroModules PROPERTIES
    IMPORTED_LOCATION "/Users/gary.hsieh/garysrc/haoji/app/node_modules/react-native-nitro-modules/android/build/intermediates/cxx/Debug/2l1m3f1p/obj/x86/libNitroModules.so"
    INTERFACE_INCLUDE_DIRECTORIES "/Users/gary.hsieh/garysrc/haoji/app/node_modules/react-native-nitro-modules/android/build/headers/nitromodules"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

