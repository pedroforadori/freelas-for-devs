import type {
  DeliveryInput as DeliveryInputDto,
  DeliveryReview,
  RatingInput,
} from '@f4d/contracts';

export type DeliveryInput = Pick<DeliveryInputDto, 'message'> & {
  links: string[];
  attachmentIds: string[];
};
export type { DeliveryReview };
export type RatingInputValue = { rating: RatingInput['rating']; comment?: string | undefined };
