/**
 * onejs-react's Image, taking a cart's files by name.
 *
 * useTexture, audio.load and useModel all take the name the sidebar shows, so
 * `<Image src="coin.png" />` is what a reader guesses. onejs-react resolves a
 * bare name against the runtime's own StreamingAssets, which in a Unity project
 * is where the cart's files are and on the site is the container's, so the same
 * line drew in Unity and 404ed on the site. Resolving through assetUrl first
 * gives one answer in both places; anything that already resolves (a URL, a
 * rooted path, assetUrl's own result) passes through untouched.
 */

import { forwardRef } from "react"
import { Image as BaseImage, type ImageElement, type ImageProps } from "onejs-react"
import { assetUrl } from "./asset"

export const Image = forwardRef<ImageElement, ImageProps>(({ src, ...rest }, ref) => (
    <BaseImage ref={ref} src={src ? assetUrl(src) : src} {...rest} />
))
Image.displayName = "Image"
