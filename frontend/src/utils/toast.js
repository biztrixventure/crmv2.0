import { toast as sonner } from 'sonner';

// Typed helpers — use these everywhere instead of alert() or setSavedMsg()
export const toast = {
  success: (msg, opts)  => sonner.success(msg, { duration: 4000, ...opts }),
  error:   (msg, opts)  => sonner.error(msg,   { duration: 6000, ...opts }),
  warning: (msg, opts)  => sonner.warning(msg, { duration: 5000, ...opts }),
  info:    (msg, opts)  => sonner.info(msg,    { duration: 4000, ...opts }),
  loading: (msg, opts)  => sonner.loading(msg, opts),
  promise: (p, opts)    => sonner.promise(p, opts),
  dismiss: (id)         => sonner.dismiss(id),
};

// Extract the error message from an Axios error or plain Error and show it
export const toastError = (err, fallback = 'Something went wrong') => {
  const msg = err?.response?.data?.error || err?.message || fallback;
  sonner.error(msg, { duration: 6000 });
};
