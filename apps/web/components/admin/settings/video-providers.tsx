"use client";

import { useCallback, useContext, useEffect, useState } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Copy, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import type { VideoProviderPublic } from "@courselit/common-models";
import { useToast } from "@courselit/components-library";
import { FetchBuilder } from "@courselit/utils";
import { AddressContext } from "@components/contexts";
import { Button } from "@components/ui/button";
import { Badge } from "@components/ui/badge";
import { Input } from "@components/ui/input";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@components/ui/alert-dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@components/ui/select";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@components/ui/tooltip";
import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormDescription,
    FormMessage,
} from "@components/ui/form";
import {
    BUTTON_CANCEL_TEXT,
    BUTTON_SAVE,
    TOAST_TITLE_ERROR,
    TOAST_TITLE_SUCCESS,
    URL_COPIED_TO_CLIPBOARD,
    VIDEO_PROVIDERS_DESCRIPTION,
    VIDEO_PROVIDERS_EMPTY,
    VIDEO_PROVIDERS_HEADER,
    VIDEO_PROVIDER_ACTIVE_BADGE,
    VIDEO_PROVIDER_ADD,
    VIDEO_PROVIDER_COMING_SOON,
    VIDEO_PROVIDER_DIALOG_ADD_TITLE,
    VIDEO_PROVIDER_DIALOG_EDIT_TITLE,
    VIDEO_PROVIDER_DISCARD_CONFIRM_ACTION,
    VIDEO_PROVIDER_DISCARD_CONFIRM_DESCRIPTION,
    VIDEO_PROVIDER_DISCARD_CONFIRM_TITLE,
    VIDEO_PROVIDER_EDIT,
    VIDEO_PROVIDER_FIELDS,
    VIDEO_PROVIDER_FIELD_REQUIRED,
    VIDEO_PROVIDER_MAKE_ACTIVE,
    VIDEO_PROVIDER_NAME_LABEL,
    VIDEO_PROVIDER_REMOVE,
    VIDEO_PROVIDER_REMOVED,
    VIDEO_PROVIDER_REMOVE_CONFIRM_DESCRIPTION,
    VIDEO_PROVIDER_REMOVE_CONFIRM_TITLE,
    VIDEO_PROVIDER_REMOVE_DISABLED_TOOLTIP,
    VIDEO_PROVIDER_SAVED,
    VIDEO_PROVIDER_SECRET_HELPER,
    VIDEO_PROVIDER_TEST,
    VIDEO_PROVIDER_TYPES,
    VIDEO_PROVIDER_TYPE_LABEL,
    VIDEO_PROVIDER_VIDEO_COUNT,
    VIDEO_PROVIDER_WEBHOOK_LABEL,
} from "@ui-config/strings";

type Pairs = { key: string; value: string }[];

// What the GraphQL API returns: key/value lists instead of records.
type ApiProvider = Omit<VideoProviderPublic, "settings" | "secretsLast4"> & {
    settings: Pairs;
    secretsLast4: Pairs;
};

const toRecord = (pairs: Pairs = []): Record<string, string> =>
    Object.fromEntries(pairs.map(({ key, value }) => [key, value]));
const toPairs = (record: Record<string, string>): Pairs =>
    Object.entries(record).map(([key, value]) => ({ key, value }));

const PROVIDER_FIELDS = `
    providerId
    type
    name
    active
    videoCount
    settings { key value }
    secretsLast4 { key value }
`;

const formSchema = z.object({
    name: z.string().trim().min(1, VIDEO_PROVIDER_FIELD_REQUIRED),
    type: z.string().min(1),
    settings: z.record(z.string(), z.string()),
    secrets: z.record(z.string(), z.string()),
});
type FormData = z.infer<typeof formSchema>;

const emptyForm = (type = "bunny"): FormData => ({
    name: "",
    type,
    settings: {},
    secrets: {},
});

export default function VideoProviders() {
    const address = useContext(AddressContext);
    const { toast } = useToast();
    const [providers, setProviders] = useState<VideoProviderPublic[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<VideoProviderPublic | null>(null);
    const [removing, setRemoving] = useState<VideoProviderPublic | null>(null);
    const [testResults, setTestResults] = useState<
        Record<string, { ok: boolean; message: string }>
    >({});
    const [testingId, setTestingId] = useState<string | null>(null);
    const [confirmDiscard, setConfirmDiscard] = useState(false);

    const form = useForm<FormData>({
        resolver: zodResolver(formSchema as any),
        defaultValues: emptyForm(),
    });

    const exec = useCallback(
        async (query: string, variables?: Record<string, unknown>) => {
            const fetcher = new FetchBuilder()
                .setUrl(`${address.backend}/api/graph`)
                .setPayload({ query, variables })
                .setIsGraphQLEndpoint(true)
                .build();
            return fetcher.exec();
        },
        [address.backend],
    );

    const showError = useCallback(
        (err: any) =>
            toast({
                title: TOAST_TITLE_ERROR,
                description: err?.message,
                variant: "destructive",
            }),
        [toast],
    );

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const response = await exec(
                `query { providers: listVideoProviders { ${PROVIDER_FIELDS} } }`,
            );
            setProviders(
                (response.providers as ApiProvider[]).map((p) => ({
                    ...p,
                    settings: toRecord(p.settings),
                    secretsLast4: toRecord(p.secretsLast4),
                })),
            );
        } catch (err: any) {
            showError(err);
        } finally {
            setLoading(false);
        }
    }, [exec, showError]);

    useEffect(() => {
        load();
    }, [load]);

    const openDialog = (provider: VideoProviderPublic | null) => {
        setEditing(provider);
        form.reset(
            provider
                ? {
                      name: provider.name,
                      type: provider.type,
                      settings: { ...provider.settings },
                      secrets: {},
                  }
                : emptyForm(),
        );
        setDialogOpen(true);
    };

    // Read during render so react-hook-form keeps isDirty up to date.
    const { isDirty } = form.formState;
    // Closing by Escape, X or Cancel asks first when values were typed.
    const requestClose = () => {
        if (isDirty) {
            setConfirmDiscard(true);
        } else {
            setDialogOpen(false);
        }
    };

    const type = form.watch("type");
    const fields = VIDEO_PROVIDER_FIELDS[type] || {
        settings: [],
        secrets: [],
    };

    const onSubmit = async (values: FormData) => {
        // Settings are always required; a secret is required only until saved.
        let valid = true;
        for (const field of fields.settings) {
            if (!values.settings[field.key]?.trim()) {
                form.setError(`settings.${field.key}` as any, {
                    message: VIDEO_PROVIDER_FIELD_REQUIRED,
                });
                valid = false;
            }
        }
        for (const field of fields.secrets) {
            if (
                !values.secrets[field.key]?.trim() &&
                !editing?.secretsLast4[field.key]
            ) {
                form.setError(`secrets.${field.key}` as any, {
                    message: VIDEO_PROVIDER_FIELD_REQUIRED,
                });
                valid = false;
            }
        }
        if (!valid) {
            return;
        }

        try {
            setSaving(true);
            await exec(
                `mutation (
                    $providerId: String,
                    $type: String!,
                    $name: String!,
                    $settings: [VideoProviderKeyValueInput!],
                    $secrets: [VideoProviderKeyValueInput!]
                ) {
                    provider: saveVideoProvider(
                        providerId: $providerId,
                        type: $type,
                        name: $name,
                        settings: $settings,
                        secrets: $secrets
                    ) { providerId }
                }`,
                {
                    providerId: editing?.providerId,
                    type: values.type,
                    name: values.name.trim(),
                    settings: toPairs(values.settings),
                    secrets: toPairs(values.secrets),
                },
            );
            toast({
                title: TOAST_TITLE_SUCCESS,
                description: VIDEO_PROVIDER_SAVED,
            });
            setDialogOpen(false);
            await load();
        } catch (err: any) {
            showError(err);
        } finally {
            setSaving(false);
        }
    };

    const makeActive = async (providerId: string) => {
        try {
            await exec(
                `mutation ($providerId: String!) {
                    setActiveVideoProvider(providerId: $providerId)
                }`,
                { providerId },
            );
            await load();
        } catch (err: any) {
            showError(err);
        }
    };

    const test = async (providerId: string) => {
        try {
            setTestingId(providerId);
            const response = await exec(
                `mutation ($providerId: String!) {
                    result: testVideoProvider(providerId: $providerId) {
                        ok
                        message
                    }
                }`,
                { providerId },
            );
            setTestResults((prev) => ({
                ...prev,
                [providerId]: response.result,
            }));
        } catch (err: any) {
            showError(err);
        } finally {
            setTestingId(null);
        }
    };

    const remove = async () => {
        if (!removing) {
            return;
        }
        try {
            await exec(
                `mutation ($providerId: String!) {
                    removeVideoProvider(providerId: $providerId)
                }`,
                { providerId: removing.providerId },
            );
            toast({
                title: TOAST_TITLE_SUCCESS,
                description: VIDEO_PROVIDER_REMOVED,
            });
            await load();
        } catch (err: any) {
            showError(err);
        } finally {
            setRemoving(null);
        }
    };

    const copy = (text: string) => {
        navigator.clipboard.writeText(text);
        toast({
            title: TOAST_TITLE_SUCCESS,
            description: URL_COPIED_TO_CLIPBOARD,
        });
    };

    return (
        <div className="flex flex-col gap-4 pt-4">
            <Card>
                <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <CardTitle>{VIDEO_PROVIDERS_HEADER}</CardTitle>
                            <CardDescription>
                                {VIDEO_PROVIDERS_DESCRIPTION}
                            </CardDescription>
                        </div>
                        <Button type="button" onClick={() => openDialog(null)}>
                            <Plus className="mr-2 h-4 w-4" />
                            {VIDEO_PROVIDER_ADD}
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    {loading && providers.length === 0 && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    {!loading && providers.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                            {VIDEO_PROVIDERS_EMPTY}
                        </p>
                    )}
                    {providers.map((provider) => {
                        const webhookUrl = `${address.backend}/api/video/webhook/${provider.providerId}`;
                        const result = testResults[provider.providerId];
                        const typeLabel =
                            VIDEO_PROVIDER_TYPES.find(
                                (t) => t.value === provider.type,
                            )?.label || provider.type;
                        return (
                            <div
                                key={provider.providerId}
                                className="flex flex-col gap-3 rounded-md border p-4"
                                data-testid={`provider-${provider.providerId}`}
                            >
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-medium">
                                        {provider.name}
                                    </span>
                                    <span className="text-sm text-muted-foreground">
                                        {typeLabel}
                                    </span>
                                    {provider.active && (
                                        <Badge>
                                            {VIDEO_PROVIDER_ACTIVE_BADGE}
                                        </Badge>
                                    )}
                                    <span className="text-sm text-muted-foreground">
                                        {provider.videoCount}{" "}
                                        {VIDEO_PROVIDER_VIDEO_COUNT}
                                    </span>
                                </div>
                                <div className="flex flex-col gap-1 text-sm">
                                    {(
                                        VIDEO_PROVIDER_FIELDS[provider.type]
                                            ?.secrets || []
                                    ).map((field) =>
                                        provider.secretsLast4[field.key] ? (
                                            <div key={field.key}>
                                                <span className="text-muted-foreground">
                                                    {field.label}:{" "}
                                                </span>
                                                <span className="font-mono">
                                                    ••••
                                                    {
                                                        provider.secretsLast4[
                                                            field.key
                                                        ]
                                                    }
                                                </span>
                                            </div>
                                        ) : null,
                                    )}
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-sm">
                                    <span className="text-muted-foreground">
                                        {VIDEO_PROVIDER_WEBHOOK_LABEL}:
                                    </span>
                                    <code className="break-all">
                                        {webhookUrl}
                                    </code>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        aria-label={`${VIDEO_PROVIDER_WEBHOOK_LABEL} copy`}
                                        onClick={() => copy(webhookUrl)}
                                    >
                                        <Copy className="h-4 w-4" />
                                    </Button>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {!provider.active && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                makeActive(provider.providerId)
                                            }
                                        >
                                            {VIDEO_PROVIDER_MAKE_ACTIVE}
                                        </Button>
                                    )}
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={
                                            testingId === provider.providerId
                                        }
                                        onClick={() =>
                                            test(provider.providerId)
                                        }
                                    >
                                        {VIDEO_PROVIDER_TEST}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => openDialog(provider)}
                                    >
                                        <Pencil className="mr-2 h-4 w-4" />
                                        {VIDEO_PROVIDER_EDIT}
                                    </Button>
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <span tabIndex={0}>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={
                                                            provider.videoCount >
                                                            0
                                                        }
                                                        onClick={() =>
                                                            setRemoving(
                                                                provider,
                                                            )
                                                        }
                                                    >
                                                        <Trash2 className="mr-2 h-4 w-4" />
                                                        {VIDEO_PROVIDER_REMOVE}
                                                    </Button>
                                                </span>
                                            </TooltipTrigger>
                                            {provider.videoCount > 0 && (
                                                <TooltipContent>
                                                    {
                                                        VIDEO_PROVIDER_REMOVE_DISABLED_TOOLTIP
                                                    }
                                                </TooltipContent>
                                            )}
                                        </Tooltip>
                                    </TooltipProvider>
                                </div>
                                {result && (
                                    <p
                                        role="status"
                                        className={
                                            result.ok
                                                ? "text-sm text-green-600"
                                                : "text-sm text-destructive"
                                        }
                                    >
                                        {result.message}
                                    </p>
                                )}
                            </div>
                        );
                    })}
                </CardContent>
            </Card>

            <Dialog
                open={dialogOpen}
                onOpenChange={(open) =>
                    open ? setDialogOpen(true) : requestClose()
                }
            >
                <DialogContent
                    // A click outside (or a password manager popup taking the
                    // focus) must not close the form and lose the typed keys.
                    onInteractOutside={(e) => e.preventDefault()}
                >
                    <DialogHeader>
                        <DialogTitle>
                            {editing
                                ? VIDEO_PROVIDER_DIALOG_EDIT_TITLE
                                : VIDEO_PROVIDER_DIALOG_ADD_TITLE}
                        </DialogTitle>
                    </DialogHeader>
                    <FormProvider {...form}>
                        <form
                            onSubmit={form.handleSubmit(onSubmit)}
                            className="flex flex-col gap-4"
                        >
                            <FormField
                                control={form.control}
                                name="type"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>
                                            {VIDEO_PROVIDER_TYPE_LABEL}
                                        </FormLabel>
                                        <Select
                                            value={field.value}
                                            onValueChange={field.onChange}
                                            disabled={!!editing}
                                        >
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {VIDEO_PROVIDER_TYPES.map(
                                                    (t) => (
                                                        <SelectItem
                                                            key={t.value}
                                                            value={t.value}
                                                            disabled={
                                                                t.disabled
                                                            }
                                                        >
                                                            {t.label}
                                                            {t.disabled
                                                                ? ` (${VIDEO_PROVIDER_COMING_SOON})`
                                                                : ""}
                                                        </SelectItem>
                                                    ),
                                                )}
                                            </SelectContent>
                                        </Select>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>
                                            {VIDEO_PROVIDER_NAME_LABEL}
                                        </FormLabel>
                                        <FormControl>
                                            <Input {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            {fields.settings.map((setting) => (
                                <FormField
                                    key={setting.key}
                                    control={form.control}
                                    name={`settings.${setting.key}` as any}
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                {setting.label}
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    value={field.value || ""}
                                                />
                                            </FormControl>
                                            {setting.hint && (
                                                <FormDescription>
                                                    {setting.hint}
                                                </FormDescription>
                                            )}
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            ))}
                            {fields.secrets.map((secret) => {
                                const saved = editing?.secretsLast4[secret.key];
                                return (
                                    <FormField
                                        key={secret.key}
                                        control={form.control}
                                        name={`secrets.${secret.key}` as any}
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {secret.label}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input
                                                        {...field}
                                                        value={
                                                            field.value || ""
                                                        }
                                                        type="password"
                                                        autoComplete="off"
                                                        data-1p-ignore
                                                        data-lpignore="true"
                                                        placeholder={
                                                            saved
                                                                ? `••••${saved}`
                                                                : ""
                                                        }
                                                    />
                                                </FormControl>
                                                {secret.hint && (
                                                    <FormDescription>
                                                        {secret.hint}
                                                    </FormDescription>
                                                )}
                                                {saved && (
                                                    <CardDescription>
                                                        {
                                                            VIDEO_PROVIDER_SECRET_HELPER
                                                        }
                                                    </CardDescription>
                                                )}
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                );
                            })}
                            <DialogFooter>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={requestClose}
                                >
                                    {BUTTON_CANCEL_TEXT}
                                </Button>
                                <Button type="submit" disabled={saving}>
                                    {BUTTON_SAVE}
                                </Button>
                            </DialogFooter>
                        </form>
                    </FormProvider>
                </DialogContent>
            </Dialog>

            <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {VIDEO_PROVIDER_DISCARD_CONFIRM_TITLE}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {VIDEO_PROVIDER_DISCARD_CONFIRM_DESCRIPTION}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>
                            {BUTTON_CANCEL_TEXT}
                        </AlertDialogCancel>
                        <AlertDialogAction onClick={() => setDialogOpen(false)}>
                            {VIDEO_PROVIDER_DISCARD_CONFIRM_ACTION}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog
                open={!!removing}
                onOpenChange={(open) => !open && setRemoving(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {VIDEO_PROVIDER_REMOVE_CONFIRM_TITLE}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {VIDEO_PROVIDER_REMOVE_CONFIRM_DESCRIPTION}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>
                            {BUTTON_CANCEL_TEXT}
                        </AlertDialogCancel>
                        <AlertDialogAction onClick={remove}>
                            {VIDEO_PROVIDER_REMOVE}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
