import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";

const AVATAR_STYLES = [
    'adventurer',
    'avataaars',
    'big-ears',
    'big-smile',
    'bottts',
    'croodles',
    'fun-emoji',
    'icons',
    'identicon',
    'initials',
    'lorelei',
    'micah',
    'miniavs',
    'open-peeps',
    'personas',
    'pixel-art',
    'shapes',
    'thumbs'
];

// We'll use 'adventurer' style for a consistent, illustrative look
// You can change the style by changing this constant
const CHOSEN_STYLE = 'adventurer';

const AVATARS = Array.from({ length: 32 }, (_, i) => ({
    id: `avatar-${i + 1}`,
    url: `https://api.dicebear.com/9.x/${CHOSEN_STYLE}/svg?seed=${i + 1}&backgroundColor=b6e3f4,c0aede,d1d4f9`
}));

export function AvatarSelectionDialog({ open, onOpenChange, onSelect }) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Choose an Avatar</DialogTitle>
                    <DialogDescription>
                        Select a profile picture from the gallery below.
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="flex-1 pr-4 -mr-4">
                    <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-4 p-2">
                        {AVATARS.map((avatar) => (
                            <Button
                                key={avatar.id}
                                variant="ghost"
                                className="h-auto p-2 hover:bg-muted aspect-square rounded-full overflow-hidden border-2 border-transparent hover:border-primary transition-all"
                                onClick={() => onSelect(avatar.url)}
                            >
                                <img
                                    src={avatar.url}
                                    alt={`Avatar ${avatar.id}`}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                />
                            </Button>
                        ))}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}
