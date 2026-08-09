import Foundation
import ModuleA
import ModuleB
import SelectedPod

#if canImport(GeneratedPod)
import GeneratedPod
final class ConditionalGeneratedChild: GeneratedPodParent {}
#endif

final class ProjectChild: ProjectBase {}
final class ProjectObjCChild: ProjectObjCBase {}
final class AppleAliasChild: URLProtocol {}
final class SelectedPodChild: SelectedPodParent {}
final class AmbiguousChild: SharedParent {}
